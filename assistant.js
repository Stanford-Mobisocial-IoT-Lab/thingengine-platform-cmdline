// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016-2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const posix = require('posix');
const Url = require('url');

const Config = require('./config');

const Almond = require('almond');

class LocalUser {
    constructor() {
        var pwnam = posix.getpwnam(process.getuid());

        this.id = process.getuid();
        this.account = pwnam.name;
        this.name = pwnam.gecos;
    }
}

class CommandLineDelegate {
    constructor(rl) {
        this._rl = rl;
    }

    send(what) {
        console.log('>> ' + what);
    }

    sendPicture(url) {
        console.log('>> picture: ' + url);
    }

    sendRDL(rdl) {
        console.log('>> rdl: ' + rdl.displayTitle + ' ' + (rdl.callback || rdl.webCallback));
    }

    sendChoice(idx, what, title, text) {
        console.log('>> choice ' + idx + ': ' + title);
    }

    sendLink(title, url) {
        console.log('>> link: ' + title + ' ' + url);
    }

    sendButton(title, json) {
        console.log('>> button: ' + title + ' ' + json);
    }

    sendAskSpecial(what) {
        console.log('>> ask special ' + what);
    }
}

module.exports = class Assistant {
    constructor(engine) {
        this._engine = engine;

        let user = new LocalUser();
        var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.setPrompt('$ ');
        this._rl = rl;

        let delegate = new CommandLineDelegate(rl);

        this._conversation = new Almond(engine, 'local-cmdline', user, delegate,
            { sempreUrl: process.env.SEMPRE_URL || Config.SEMPRE_URL,
              debug: false, showWelcome: true });

        this._oauthKind = null;
        this._oauthSession = {};
    }

    notifyAll(...data) {
        this._conversation.notify(...data);
    }

    notifyErrorAll(...data) {
        this._conversation.notifyError(...data);
    }

    getConversation(id) {
        return this._conversation;
    }

    _quit() {
        console.log('Bye\n');
        this._rl.close();
        this._engine.close().then(() => {
            this._engine.platform.exit();
        }).done();
    }

    _help() {
        console.log('Available commands:');
        console.log('\\q : quit');
        console.log('\\r <json> : send json to Almond');
        console.log('\\c <number> : make a choice');
        console.log('\\t <code> : send ThingTalk to Almond');
        console.log('\\m self : print own messaging identities');
        console.log('\\m identity <identity> : lookup messaging identity, save to contacts');
        console.log('\\m search <name> : list contacts by name');
        console.log('\\a list : list apps');
        console.log('\\a stop <uuid> : stop app');
        console.log('\\d list : list devices');
        console.log('\\d start-oauth <kind> : start oauth');
        console.log('\\d complete-oauth <url> : finish oauth');
        console.log('\\p list : list permissions');
        console.log('\\p revoke <uuid> : revoke permissions');
        console.log('\\l: test the log system');
        console.log('\\? or \\h : show this help');
        console.log('Any other command is interpreted as an English sentence and sent to Almond');
    }

    _runPermissionCommand(cmd, param) {
        if (cmd === 'list') {
            for (let permission of this._engine.permissions.getAllPermissions()) {
                console.log('- ' + permission.uniqueId + ': ' + permission.code + ' : ' + permission.description);
            }
        } else if (cmd === 'revoke') {
            this._engine.permissions.removePermission(param);
        }
    }

    _runMessagingCommand(cmd, param) {
        if (cmd === 'self') {
            for (let identity of this._engine.messaging.getIdentities())
                console.log(identity);
        } else if (cmd === 'identity') {
            return this._engine.messaging.getAccountForIdentity(param).then((account) => {
                console.log(account);
            });
        } else if (cmd === 'search') {
            return this._engine.messaging.searchAccountByName(param).then((accounts) => {
                for (let account of accounts)
                    console.log(`${account.name}: ${account.account}`);
            });
        }
    }

    _runAppCommand(cmd, param) {
        if (cmd === 'list') {
            this._engine.apps.getAllApps().forEach((app) => {
                console.log('- ' + app.uniqueId + ' ' + app.name + ': ' + app.description);
            });
        } else if (cmd === 'stop') {
            var app = this._engine.apps.getApp(param);
            if (!app) {
                console.log('No app with ID ' + param);
            } else {
                this._engine.apps.removeApp(app);
            }
        }
    }

    _runDeviceCommand(cmd, param) {
        if (cmd === 'list') {
            this._engine.devices.getAllDevices().forEach((dev) => {
                console.log('- ' + dev.uniqueId + ' (' + dev.kind +') ' + dev.name + ': ' + dev.description);
            });
        } else if (cmd === 'start-oauth' || cmd === 'start-oauth2') {
            this._oauthKind = param;
            return this._engine.devices.factory.runOAuth2(param, null).then(([redirect, session]) => {
                this._oauthSession = session;
                console.log(redirect);
            });
        } else if (cmd === 'complete-oauth' || cmd === 'complete-oauth2') {
            let req = {
                httpVersion: '1.0',
                headers: [],
                rawHeaders: [],
                method: 'GET',
                url: param,
                query: Url.parse(param, true).query,
                session: this._oauthSession
            };
            return this._engine.devices.factory.runOAuth2(this._oauthKind, req);
        }
    }

    _testLog() {
        this._engine.ibase.query(['wind_speed', 'location'], [{name: 'weather', op: '=', value: 'Partly cloud'}]).then((res) => {
            console.log(res);
        });
        this._engine.ibase.getCount([{name: 'wind_speed', op: '>', value: 1}]).then((res) => {
            console.log(res);
        });
        this._engine.ibase.getMax('wind_speed', []).then((res) => {
            console.log(res);
        });
        this._engine.ibase.getMin('wind_speed', []).then((res) => {
            console.log(res);
        });
        this._engine.ibase.getSum('wind_speed', []).then((res) => {
            console.log(res);
        });
        this._engine.ibase.getAvg('wind_speed', []).then((res) => {
            console.log(res);
        });
        this._engine.ibase.getArgmax(['location', 'weather'], 'wind_speed', []).then((res) => {
            console.log(res);
        });
        this._engine.ibase.getArgmin(['location', 'weather'], 'wind_speed', []).then((res) => {
            console.log(res);
        });
    }

    interact() {
        this._conversation.start();

        this._rl.on('line', this._onLine.bind(this));
        this._rl.on('SIGINT', this._quit.bind(this));

        this._rl.prompt();
    }

    _onLine(line) {
        Q.try(() => {
            if (line[0] === '\\') {
                if (line[1] === 'q')
                    return this._quit();
                else if (line[1] === '?' || line === 'h')
                    return this._help();
                else if (line[1] === 'r')
                    return this._conversation.handleParsedCommand(line.substr(3));
                else if (line[1] === 't')
                    return this._conversation.handleThingTalk(line.substr(3));
                else if (line[1] === 'c')
                    return this._conversation.handleParsedCommand(JSON.stringify({ answer: { type: "Choice", value: parseInt(line.substr(3)) }}));
                else if (line[1] === 'a')
                    return this._runAppCommand(...line.substr(3).split(' '));
                else if (line[1] === 'd')
                    return this._runDeviceCommand(...line.substr(3).split(' '));
                else if (line[1] === 'm')
                    return this._runMessagingCommand(...line.substr(3).split(' '));
                else if (line[1] === 'p')
                    return this._runPermissionCommand(...line.substr(3).split(' '));
                else if (line[1] === 'l')
                    return this._testLog();
                else
                    console.log('Unknown command ' + line[1]);
            } else if (line.trim()) {
                return this._conversation.handleCommand(line);
            }
        }).then(() => {
            this._rl.prompt();
        }).done();
    }
}
