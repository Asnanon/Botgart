import * as sqlite3 from "better-sqlite3";
import { log } from "./Util";

export class Database {
    public static getInstance(databaseFilePath){
        const database = new Database(databaseFilePath);
        database.initSchema();
        log("info", "Database initialised.");
        return database;
    }

    readonly file: string;

    constructor(file: string) {
        this.file = file;
    }

    // NOTE: https://github.com/orlandov/node-sqlite/issues/17
    // sqlite3 and node don't work well together in terms of large integers.
    // Therefore, all big numbers are stored as strings.
    // As a consequence, === can't be used, when checking them.
    /**
    * Initial schema. All patches should be applied after
    * creating the init.
    */ 
    public initSchema(): void {
        let sqls = [
        `CREATE TABLE IF NOT EXISTS registrations(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT NOT NULL,
            guild TEXT NOT NULL,
            api_key TEXT NOT NULL,
            gw2account TEXT NOT NULL,
            registration_role TEXT,
            created TIMESTAMP DEFAULT (datetime('now','localtime')),
            UNIQUE(user, guild) ON CONFLICT REPLACE,
            UNIQUE(guild, api_key)
        )`, // no ON CONFLICT for second unique, that's an actual error
        `CREATE TABLE IF NOT EXISTS cronjobs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule TEXT NOT NULL,
            command TEXT NOT NULL,
            arguments TEXT,
            created_by TEXT NOT NULL,
            guild TEXT NOT NULL,
            created TIMESTAMP DEFAULT (datetime('now','localtime'))
        )`,
        `CREATE TABLE IF NOT EXISTS faqs(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            created_by TEXT NOT NULL,
            guild TEXT NOT NULL,
            created TIMESTAMP DEFAULT (datetime('now','localtime'))
        )`, 
        `CREATE TABLE IF NOT EXISTS faq_keys(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL,
            faq_id INTEGER,
            created_by TEXT NOT NULL,
            guild TEXT NOT NULL,
            created TIMESTAMP DEFAULT (datetime('now','localtime')),
            UNIQUE(key) ON CONFLICT REPLACE,
            FOREIGN KEY(faq_id) REFERENCES faqs(id) 
                ON UPDATE CASCADE
                ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS index_faq_keys_key ON faq_keys(key)`
        ]; 
        sqls.forEach(sql => this.execute(db => db.prepare(sql).run()));
    }

    /**
    * Executes an SQL statement and handles errors, as well as closing the DB connection afterwards.
    * f: lambda expression taking the opened sqlite3 connection to run queries on.
    * returns: the result of the lambda.
    */
    public execute<T>(f: (sqlite3) => T): T|undefined  {
        let db: sqlite3.Database = sqlite3.default(this.file, undefined);
        db.pragma("foreign_keys = ON");

        let res: T|undefined;
        try {
            res = f(db);
        } catch(err) {
            res = undefined;
            log("error", `DB execute: ${err["message"]} (stack: ${new Error().stack})`);
        }

        db.close();
        return res;
    }
}
