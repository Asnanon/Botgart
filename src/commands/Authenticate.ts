import * as discord from "discord.js";
import { BotgartClient } from "../BotgartClient";
import { BotgartCommand } from "../BotgartCommand";
import { getConfig } from "../config/Config";
import { getAccountGUID, getAccountName, validateWorld } from "../Gw2ApiUtils";
import * as L from "../Locale";
import * as Util from "../Util";

/**
Testcases:
- missing parameters -> error
- valid key -> authenticated
- valid duplicate key for the same user -> key replaced
- valid duplicate key for another user -> error
- invalid key with valid format -> error
- all of the above through DM and channel -> _
- all of the above with missing authenticate role -> error
- cron: anything -> error
*/

export class Authenticate extends BotgartCommand {
    private static readonly LOG_TYPE_AUTH : string = "auth";

    constructor() {
        super("authenticate", {
            aliases: ["register","authenticate","auth"],
            args: [
                {
                    id: "key",
                    type: "string",
                    default: ""
                },
            ]
        },
        {
            availableAsDM: true,
            everyonePermission: 1
        }
        );
    }

    command(message: discord.Message, responsible: discord.User, guild: discord.Guild, args: any): void {
        if(!message) {
            Util.log("error", "Mandatory message parameter missing. This command can not be issued as cron.");
            return;
        }

        let members: {guild: discord.Guild, member: discord.GuildMember}[] = []; // plural, as this command takes place on all servers this bot shares with the user
        let reply = "";
        // this snippet allows users to authenticate themselves
        // through a DM and is dedicated to Jey, who is a fucking 
        // numbnut when it comes to data privacy and posting your
        // API key in public channels.
        this.client.guilds.cache.forEach(async g => {
            const m: discord.GuildMember = await g.members.fetch(message.author.id); // cache.find(m => m.id == message.author.id);
            if(m) {
                members.push({guild: g, member: m});
            }
        });

        message.util?.send(L.get("CHECKING_KEY"))
        // 11111111-1111-1111-1111-11111111111111111111-1111-1111-1111-111111111111
        const validFormat: boolean = /^\w{8}-\w{4}-\w{4}-\w{4}-\w{20}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(args.key)
        if(!validFormat) {
            message.util?.send(L.get("KEY_INVALID_FORMAT"));
            return;
        } else {
            // try to delete the message for privacy reasons if it is not a direct message
            if(message && message.member) {
                if(message.deletable) {
                    message.delete();
                } else {
                    message.util?.send(L.get("NO_DEL_PERM"));
                }
            }
            const cl: BotgartClient = this.getBotgartClient();
            const worldAssignments = getConfig().get().world_assignments;
            validateWorld(args.key, worldAssignments).then(
                role => {
                    if(role === false) {
                        Util.log("info", "Declined API key {0}.".formatUnicorn(args.key));
                        reply = L.get("KEY_DECLINED");
                        responsible.send(reply);                    
                    } else {
                        getAccountGUID(args.key).then(async guid => {
                            await Util.asyncForEach(members, async (m: {guild: discord.Guild, member: discord.GuildMember}) => {
                                let r: discord.Role | undefined = m.guild.roles.cache.find(r => r.name === role);
                                if(r === undefined) {
                                    Util.log("error", "Role '{0}' not found on server '{1}'. Skipping.".formatUnicorn(role, m.guild.name));
                                    reply = L.get("INTERNAL_ERROR");
                                } else {
                                    let accountName: string | boolean = await getAccountName(args.key);
                                    let i = 3;
                                    while(accountName === false && i > 0) {
                                        accountName = await getAccountName(args.key);
                                        i--;
                                    }
                                    if(accountName === false) {
                                        Util.log("warning", "After trying several times, I could not resolve the account name for discord user {0}. This may be a temporary problem with the API. Falling back to NULL to fix another day.".formatUnicorn(responsible.username));
                                        accountName = "";
                                    }
                                    let unique = cl.registrationRepository.storeAPIKey(m.member.user.id, m.guild.id, args.key, guid.toString(), <string>accountName, r.name); // this cast should pass, since we either resolved by now or fell back to NULL
                                    if(unique) {
                                        Util.log("info", "Accepted {0} for {1} on {2} ({3}).".formatUnicorn(args.key, m.member.user.username, m.guild.name, m.guild.id));
                                        // FIXME: check if member actually has NULL as current role, maybe he already has one and entered another API key
                                        Util.assignServerRole(m.member, null, r);
                                        // give earned achievement roles again
                                        for(const achievement of cl.achievementRepository.getPlayerAchievements(guid.toString()).map(an => cl.getAchievement(an.achievement_name)).filter(a => a !== undefined)) {
                                            achievement?.giveRole(m.member);
                                        }
                                        cl.discordLog(m.guild, Authenticate.LOG_TYPE_AUTH, L.get("DLOG_AUTH", [Util.formatUserPing(m.member.id), <string>accountName, r.name]), false);
                                        reply = L.get("KEY_ACCEPTED")
                                    } else {
                                        Util.log("info", "Duplicate API key {0} on server {1}.".formatUnicorn(args.key, m.guild.name));
                                        reply = L.get("KEY_NOT_UNIQUE")
                                    }
                                }
                            });
                            responsible.send(reply);
                        });   
                    }
                }, err => {
                    switch(err) {
                        case validateWorld.ERRORS.config_world_duplicate:
                            Util.log("error", "A world is defined more than once in the config. Please fix the config file.");  
                            responsible.send(L.get("INTERNAL_ERROR"));
                            break;
                        case validateWorld.ERRORS.network_error:
                            Util.log("error", "Network error while trying to resolve world.");
                            responsible.send(L.get("INTERNAL_ERROR"));
                            break;
                         case validateWorld.ERRORS.invalid_key:
                            Util.log("error", "Invalid key: {0}".formatUnicorn(args.key));
                            responsible.send(L.get("KEY_DECLINED"));
                            break;
                        default:
                            Util.log("error", "Unexpected error occured while validating world.");
                            Util.log("error", err);
                            responsible.send(L.get("INTERNAL_ERROR"));
                    }
                }
            );
        }       
    }
}

module.exports = Authenticate;