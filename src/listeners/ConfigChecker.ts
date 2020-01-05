const config = require("../../config.json");
import { Listener } from "discord-akairo";
import { log } from "../Util";
import * as validate from "validate.js";
const gw2 = require("gw2api-client");
const api = gw2();

validate.validators.isArray = (value, options, key, attributes) => { 
    const m = options.message || (x => "not an array."); 
    return validate.isArray(value) ? null : m(value); 
};

validate.validators.all = (value, options, key, attributes) => {
    let m = options.message || (x => "{0} did not pass the specified criterion.".formatUnicorn(JSON.stringify(x)));
    let f = options.func;

    let errs = [];
    if(Array.isArray(value)) {
        value.forEach(v => {
            let res = f(v);
            if(res !== undefined) {
                errs.push(res);
            }
        });
    }
    return errs.length === 0 ? null : errs;
};

validate.validators.allAsync = (value, options, key, attributes) => new Promise((resolve, reject) => Promise.all(validate.validators.all(value, options, key, attributes))
    .then(
        res => { let errs = res.filter(r => r !== null); resolve(errs.length === 0 ? null : errs) }
    )
    .catch(
        err => console.log("Error while validating config file", err))
);

validate.validators.any = (value, options, key, attributes) => {
    let m = options.message || (x => "not a single element passed the qualification criterion.");
    return value.reduce((acc, x) => acc || options.func(x), false) ? null : m(value);
};

validate.validators.isValidWorld = (value, options, key, attributes) => {
    options = options || {};
    let m = options.message || (x => "world with ID {0} could not be resolved.".formatUnicorn(x));
    return api.worlds().all().then(
        ws => new Promise(
            (resolve, reject) => resolve(ws.filter(w => w.id === value).length > 0 ? null : m(value))));
};

export class ConfigChecker extends Listener {
    constructor() {
        super("ConfigChecker", {
            emitter: "client",
            eventName: "ready"
        });
    }

    exec() {
        // function(value, attribute, validatorOptions, attributes, globalOptions)
        var constraints = {
          owner_ids: {
            presence: true,
            isArray: {},
            all: {
                func: x => /^\d+$/.test(x) ? undefined : validate.format("^%{num} is not a valid owner-ID", {num: x})
            }
          },
          prefix: {
            presence: true,
            format: {
              pattern: /.+$/,
              message: (v, a, vos, as, gos) => validate.format("^%{pref} is not a valid prefix", {pref: v})
            }
          },
          token: {
            presence: true,
            format: {
              pattern: /.+$/,
              message: (v, a, vos, as, gos) => validate.format("^%{tok} is not a valid token", {tok: v})
            }
          },
         home_id: {
            presence: true,
            numericality: {
              strict: true
            }
          },
         world_assignments: {
            presence: true,
            isArray: {},
            all: {
                func: x => validate.validate(x, {
                                world_id: {
                                    presence: true,
                                    numericality: {
                                        strict: true
                                    }                                  
                                },
                                role: {
                                    presence: true
                                }
                            })
            }
          },
        disabled: {
            presence: true
        },
        "disabled.listeners": {
            presence: true,
            isArray: {}
        },
        "disabled.commands": {
            presence: true,
            isArray: {}
        },
        "disabled.inhibitors": {
            presence: true,
            isArray: {}
        },
        achievements: {
            presence: true
        },
        "achievements.channel": {
            presence: true
        },
        "achievements.ignoring_roles": {
            presence: true,
            isArray: {}
        },
        ts_unregister_protection: {
          presence: true,
          isArray: {},
          all: {
                func: x => validate.validate(x, {
                                format: {
                                  pattern: /^.+\.\d+$/,
                                  message: (v, a, vos, as, gos) => validate.format("^%{tok} is not a valid GW2 account", {tok: v})
                                }
                            })
          }
        } 
        };

        let asyncConstraints =  {
            home_id: {
                isValidWorld: {}
            },
            world_assignments: {
                allAsync: {
                    func: x =>  validate.async(x, {
                                    world_id: {
                                        isValidWorld: {},                                  
                                    },
                                }).then(_ => null) // no errors
                                  .catch(err => err) // could not be resolved 
                }
                                
            }
        };

        let handleErrors = errors => {
            for(let k in errors) {
                log("error", "ConfigChecker.js", "Error while validating config entry '{0}': {1}".formatUnicorn(k, JSON.stringify(errors[k])));
            }
            if(errors) {
                log("crit", "ConfigChecker.js", "config.json contains invalid entries. Shutting down preventively. Please fix the config according to the log.");
            } else {
                log("info", "ConfigChecker.js", "Done checking config.json. No errors detected.");    
            }
            return errors !== undefined;
        };

        let shutDown = handleErrors(validate.validate(config, constraints));
        validate.async(config, asyncConstraints).then(
            _ => null,
            errs => {
                shutDown = shutDown || handleErrors(errs);
                if(shutDown) {
                    process.exit(1);
                }
            }
        );
    }
}

module.exports = ConfigChecker;