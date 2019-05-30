"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const schedule = __importStar(require("node-schedule"));
const L = __importStar(require("../../Locale"));
const BotgartCommand_1 = require("../../BotgartCommand");
const Util_1 = require("../../Util");
// FIXME: move exec to command
/**
Testcases:
- schedule cron with id
- schedule cron with alias
*/
class MakeCronCommand extends BotgartCommand_1.BotgartCommand {
    constructor() {
        super("makecron", {
            aliases: ["makecron", "mkcron"],
            split: "quoted",
            args: [
                {
                    id: "schedule",
                    type: "string",
                    default: ""
                },
                {
                    id: "cmd",
                    type: "string" //"commandAlias"
                },
                {
                    id: "args",
                    match: "rest"
                }
            ],
            userPermissions: ["ADMINISTRATOR"]
        }, false, // available per DM
        false // cronable
        );
    }
    desc() {
        return L.get("DESC_MAKE_CRON");
    }
    checkArgs(args) {
        return !args || !args.schedule || !args.cmd || !args.args ? L.get("HELPTEXT_ADD_CRON") : undefined;
    }
    /**
    * Executes the command.
    * @returns {int} - Error Code:
    * >0 - Cronjob ID
    * -1 - NO_SUCH_COMMAND
    * -2 - CIRCULAR_CRON
    * -3 - NOT_CRONABLE
    * -4 - The scheduled command cannot be executed, wrong arguments
    * -5 - CRONJOB_NOT_STORED
    */
    command(message, responsible, guild, args, internal_call = false) {
        if (!message.member) {
            return message.author.send(L.get("NOT_AVAILABLE_AS_DM"));
        }
        const schedule = args.schedule;
        const cmd = args.cmd;
        const cmdargs = args.args;
        // we could use commandAlias as type for the mod parameter,
        // but then invalid commands just result in undefined.
        // That doesn't give us the opportunity to give feedback to the user what his faulty command string was.
        // So we look for the command for ourselves from a plain string.
        let mod = this.client.commandHandler.modules[cmd] || Array.from(this.client.commandHandler.modules.values()).find(m => m.aliases.includes(cmd));
        if (!mod) {
            message.util.send(L.get("NO_SUCH_COMMAND").formatUnicorn(cmd));
            return -1;
        }
        // crons can not schedule other crons for shenanigans-reasons
        if (mod.id == this.id) {
            message.util.send(L.get("CIRCULAR_CRON"));
            return -2;
        }
        if (!mod.cronable) {
            message.util.send(L.get("NOT_CRONABLE"));
            return -3;
        }
        return mod.parse(cmdargs, message).then(parsedArgs => {
            let checkError = mod.checkArgs(parsedArgs);
            if (checkError !== undefined) {
                // The scheduled command cannot be executed, wrong arguments.
                message.util.send(checkError);
                return -4;
            }
            else {
                let cl = this.client;
                let job = this.scheduleCronjob(schedule, message.member.user, message.guild, mod, parsedArgs);
                if (!job) {
                    message.util.send(L.get("CRONJOB_NOT_STORED"));
                    return -5;
                }
                else {
                    let cid = cl.db.storeCronjob(schedule, mod.id, mod.serialiseArgs(parsedArgs), message.member.user.id, message.guild.id);
                    cl.cronjobs[cid] = job;
                    Util_1.log("info", "MakeCron.js", "Scheduled new cron of type '{0}' with ID {1}.".formatUnicorn(mod.id, cid));
                    if (!internal_call)
                        message.util.send(L.get("CRONJOB_STORED").formatUnicorn(cid, job.nextInvocation));
                    return cid;
                }
            }
        });
    }
    /**
    * Reschedules all cronjobs that are still in the database.
    * @returns {int} - number of successfully scheduled crons.
    */
    rescheduleCronjobs() {
        let croncount = 0;
        let cl = this.client;
        cl.db.getCronjobs().forEach(cron => {
            let mod = this.client.commandHandler.modules.get(cron.command);
            let args = mod.deserialiseArgs(cron.arguments || "{}"); // make sure JSON.parse works for empty command args
            let guild = this.client.guilds.find(g => g.id == cron.guild);
            if (!guild) {
                Util_1.log("error", "MakeCron.js", "I am no longer member of the guild {0} the cronjob with ID {1} was scheduled for. Skipping.".formatUnicorn(cron.guild, cron.id));
            }
            else {
                let responsible = guild.members.find(m => m.user.id == cron.created_by);
                let job;
                if (!responsible) {
                    Util_1.log("warn", "MakeCron.js", "Responsible user with ID {0} for cronjob {1} is no longer present in Guild {2}.".formatUnicorn(cron.created_by, cron.id, guild.name));
                }
                else {
                    job = this.scheduleCronjob(cron.schedule, responsible.user, guild, mod, args);
                }
                if (!job) {
                    Util_1.log("error", "MakeCron.js", "Could not reschedule cronjob {0} although it was read from the database.".formatUnicorn(cron.id));
                }
                else {
                    if (cron.id in cl.cronjobs && cl.cronjobs[cron.id]) {
                        // just to be safe, cancel any remaining jobs before rescheduling them
                        cl.cronjobs[cron.id].cancel();
                    }
                    cl.cronjobs[cron.id] = job;
                    croncount++;
                    Util_1.log("info", "MakeCron.js", "Rescheduled cronjob {0} of type '{1}'".formatUnicorn(cron.id, cron.command));
                }
            }
        });
        Util_1.log("info", "MakeCron.js", "Done rescheduling {0} cronjobs.".formatUnicorn(croncount));
        return croncount;
    }
    /**
    * Schedules a new cronjob.
    * That is: it creates a cronjob, no database is involved at this point.
    * @param {string} time - cron string.
    * @param {User} responsible - who issued the cron.
    * @param {Guild} guild - Guild.
    * @param {Command} cmd - Command-module to execute.
    * @param {Map} args - Args for the command.
    * @returns {scheduleJob}
    */
    scheduleCronjob(time, responsible, guild, cmd, args) {
        return schedule.scheduleJob(time, function (m, r, g, as) {
            m.command(null, r, g, as);
        }.bind(this, cmd, responsible, guild, args));
    }
}
exports.MakeCronCommand = MakeCronCommand;
module.exports = MakeCronCommand;
