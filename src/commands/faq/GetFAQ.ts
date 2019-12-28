import { Command } from "discord-akairo";
import { assertType } from "../../Util";
import * as Const from "../../Const";
import * as L from "../../Locale";
import * as discord from "discord.js";
import { BotgartClient } from "../../BotgartClient";
import { BotgartCommand } from "../../BotgartCommand";

/**
Testcases:
- missing key -> feedback to user
- existing key -> bot posts corresponding faq
- non-existing key -> feedback to user
*/

export class GetFaq extends BotgartCommand {
    constructor() {
        super("getfaq", {
            aliases: ["getfaq","faq","getrtfm","rtfm"],
            args: [
                {
                    id: "key",
                    type: "string"
                }
            ]
        },
        false,  // available per DM
        true, // cronable
        1 // everyone permission
        );
    }

    command(message: discord.Message, responsible: discord.User, guild: discord.Guild, args): void {
        let faq = (<BotgartClient>this.client).db.getFAQ(args.key, guild.id);
        let response = faq ? faq.text : L.get("FAQ_NOT_FOUND").formatUnicorn(args.key);
        this.reply(message, responsible, response);
    }
}

module.exports = GetFaq;