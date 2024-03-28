/* ***********************************************
 * lyngdorf_server
 * based on code borrowed from whatsPlaying
 * whatsplaying code Copyright (C) Greg Brown, All rights reserved.
 * https://github.com/gregtbrown/whatsPlaying
 * ***********************************************/

'use strict';

const Path = require('path');
const Hapi = require('@hapi/hapi');
const RequestLib = require('request');
const Gpio = require('onoff').Gpio;

var readline = require('readline');

var lastkeyname = '';
var lastScreenPowerState = true;
var haveSeenAmpPowerOn = false;

process.stdin.on('keypress', (chunk, key) => {
	if (key) {
		//debug('key: '+key.name);
		lastkeyname=key.name;
		switch (key.name) {
			case 'q': process.exit();break;
		}
	}
});

const Config = require('./myconfig');

const controlSignal = (Config.shutdownOnControlSignal?new Gpio(3, 'in', 'rising', {debounceTimeout: 100}):null);

if (Config.shutdownOnControlSignal) {
  // GPIO stuff 
  controlSignal.watch((err,value) => {
  if(err) {
    debug('error in control Signal handler');
    throw (err);
  }
  if (controlSignal.readSync()) {
    debug('control Signal handler was called, line still low');
    if(Config.shutdownOnControlSignal)
      shell.exec('sudo /usr/sbin/shutdown -h now');
  } else {
    debug('control Signal handler was called, line is now high');
  }
})

}

var shell = require('shelljs');
var net = require('net');
var client;

var currentStatus={power:'UNKNOWN',volume:'UNKNOWN',sourceIndex:'-1',sourceName:'UNKNOWN',mute:'UNKNOWN',streamType:'UNKNOWN',controlSignal:'UNKNOWN',connected:false,demoMode:false};

var demoLoopIndex=0;

// -- globals --

const gFileName = {
  homePage: 'lyngdorf_server/public/index.html',
  playPage: 'app/whatsPlaying2.html',
  config: 'app/myconfig2.js',
  script: 'app/whatsPlaying2.js',
};

// error handler
process.on('unhandledRejection', (err) => {

  debug(err);
  process.exit(1);
});

process.on('SIGINT', _ => {
  if (Config.shutdownOnControlSignal) {
    debug('SIGINT received, releasing GPIO control');
    controlSignal.unexport();
  }
})

// create the server
function createServer() {

  if (typeof Config.port === 'undefined')
    Config.port = 80;

  var serverOpts = {
    port: Config.port,
    routes: {
      cors: true,
      files: {
        //relativeTo: Path.join(__dirname, 'public')
        relativeTo: Path.join(__dirname, '..')
      }
    }
  };

  if (typeof Config.ip !== 'undefined')
    serverOpts.host = Config.ip;

  return new Hapi.server(serverOpts);
}

// setup the routes
function setupRoutes(server) {

  // notes:
  //   'control' --> control ui (i.e. home-page / login-screen)
  //   'app' --> app ui (i.e. now playing screen on device) 

  // default route
  server.route({
    method: '*',
    path: '/{any*}',
    handler: function (req, h) {
              var resp = h.response('Page Not Found!');
              resp.code(404);
              return resp;
            }
  });

  // control: home page (login screen)
  server.route({
    method: 'GET',
    path: '/',
    handler: function (req, h) { return h.file(gFileName.homePage); }    
  });

  // control: play page (play screen)
  server.route({
    method: 'GET',
    path: '/play',
    handler: function (req, h) { return h.file(gFileName.playPage); }
  });

  // control: scripts for play screen
  server.route({
    method: 'GET',
    path: '/myconfig2.js',
    handler: { file: { path: gFileName.config}}
  });
  server.route({
    method: 'GET',
    path: '/whatsPlaying2.js',
    handler: { file: { path: gFileName.script}}
  });

  // static assets
    server.route({
        method: 'GET',
        path: '/assets/{param*}',
        handler: { 
            directory: {
                path: 'app/assets',
                /* redirectToSlash: true,
                index: true, */
            }
        }
    });
  
  // control: send status request
  server.route({
    method: 'GET',
    path: '/status',
    handler: async function (req, h) { return getStatus(req, h); }
  });

  // control: send status request
  server.route({
    method: 'GET',
    path: '/toggleMute',
    handler: async function (req, h) { return toggleMute(req, h); }
  });

  // control: send status request
  server.route({
    method: 'GET',
    path: '/volumeDown',
    handler: async function (req, h) { return volumeDown(req, h); }
  });
  
  // control: send status request
  server.route({
    method: 'GET',
    path: '/volumeUp',
    handler: async function (req, h) { return volumeUp(req, h); }
  });

}

// -- helper functions --

function debug(msg) {
  if (!Config.debug)
    return;
  switch(typeof(msg)) {
    case 'string': console.log((new Date().toUTCString())+' '+msg);break;
    default: console.log((new Date().toUTCString()));console.log(msg);break;
  }
}

function initDemoMode() {
	Config.demoMode = true; // to allow demo mode to be used as a fallback if the socket fails for some reason
  currentStatus.demoMode = true;
	demoUpdate();
	setInterval(demoUpdate,Config.demoCycleTime * 1000);
}

// start the server
async function run() {
  debug('starting lyngdorf_server, press \'q\' to exit');
  if(typeof Config.shutdownOnControlSignal === 'undefined')
    Config.shutdownOnControlSignal = false;
  if(typeof Config.powerScreenByAmp === 'undefined')
    Config.powerScreenByAmp = false;
  if(typeof exports.refreshInterval === 'undefined')
    exports.refreshInterval = 500;
    
  readline.emitKeypressEvents(process.stdin);

  if (process.stdin.isTTY)
    process.stdin.setRawMode(true);
    
  var server = createServer();
  await server.register(require('@hapi/inert'));  // static file handling
  setupRoutes(server);
  await server.start();
  debug(`Server running at: ${server.info.uri}`);
  if (Config.demoMode) {
	initDemoMode();
  } else {
	  client = new net.Socket();
	  var res=await client.connect(84, Config.lyngdorfaddress, function() {
	  debug('Lyngdorf device Connected');});
	  client.write('!VERB(0)?\n');
	  client.on('data', function(data) {
	    processResponse(Buffer.from(data).toString());
	  });
	  client.on('close', function() {
	    debug('Connection closed');
	  });  
	  client.on('error', function() {
	    if (Config.demoIfError) {
		  debug('Socket error, falling back to demo mode');
      client.destroySoon();
		  initDemoMode();
		} else {
		  debug('Socket error');
		}
	  });  
	  getStatus();
	}
  if (controlSignal)
	  if (controlSignal.readSync()) {
		debug('control Signal line still low');
	  } else {
		debug('control Signal line is high');
	  }
    
  if (Config.refreshInterval>0)
    setInterval(refreshStatus,Config.refreshInterval);

};

// wrapper for post/fetch
async function post(options) {

  // note: ideally get rid of request library since it is deprecated

  if (typeof RequestLib !== 'undefined') {
    return new Promise(function(resolve, reject) {
      RequestLib.post(options, function(error, response, body) {
        if (error)
          reject(error);
        else
          resolve({response: response, body: body});
      });
    });
  }

  // note: fetch in node is still experimental

  var body = options.form;
  if (body) {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = Querystring.stringify(body);
  } else {
    body = options.json;
    options.headers['Content-Type'] = 'application/json';
  }

  var res = await fetch(options.url, {
    method: 'POST',
    headers: options.headers,
    body: body
  });

  var status = res.status;

  if (status == 200)
    res = await res.json();
  else
    res = null;

  return {response: {statusCode: status}, body: res};
}

function setScreenPower(state) {
  if (currentStatus.connected) {
    // only fiddle with the screen if there is actually an amp connected
    switch(state) {
      case true: haveSeenAmpPowerOn = true;if (!lastScreenPowerState) { debug('switching screen on'); shell.exec('/usr/local/bin/screen_on.sh');lastScreenPowerState = true};break;
      case false: if (lastScreenPowerState && haveSeenAmpPowerOn) { debug('switching screen off'); shell.exec('/usr/local/bin/screen_off.sh');lastScreenPowerState = false};break;
    }
  }
}

function processResponse(resp){
	var verb='';
	var val='';
	var mode='drop'
  
  currentStatus.connected=true;
  
	for (let i=0;i<resp.length;i++){
		var c=resp.charAt(i);
		switch(c) {
			case '!':
			  mode='verb';
			break;
			case '(':
			  mode='val';
			break;
			case ')':
			  switch(verb){
				  case 'PWR': currentStatus.power=val; if (Config.powerScreenByAmp) setScreenPower(currentStatus.power==='ON'); break;
				  case 'VOL': currentStatus.volume=val;break;
				  case 'SRC': currentStatus.sourceIndex=val;break;
				  case 'MUTE': currentStatus.mute=val;break;
				  case 'SRCNAME': currentStatus.sourceName=val.substring(val.indexOf(",")+2,val.length-1);break;		  
				  case 'STREAMTYPE': currentStatus.streamType=val;break;				  
			  }
			  verb='';
			  val='';
			  mode='drop';
			break;
			default:
			  switch(mode){
				  case 'verb': verb=verb+c;break;
				  case 'val': val=val+c;break;				  
			  }
			  
		}
	}
	switch(lastkeyname) {
		// keyboard input on the terminal can be used to fake some signals. Nice for debugging.
		case 'o': debug('key \'o\': power \'ON\'');currentStatus.power='ON';break;
		case 'p': debug('key \'p\': power \'OFF\'');currentStatus.power='OFF';break;
		case 'm': debug('key \'m\': mute \'ON\'');currentStatus.mute='ON';break;
		case 'n': debug('key \'n\': mute \'OFF\'');currentStatus.mute='OFF';break;
		case '4': debug('key \'4\': source \'4\'');currentStatus.sourceName='TV';currentStatus.sourceIndex='4';break;
		case '8': debug('key \'8\': source \'8\'');currentStatus.sourceName='Spotify';currentStatus.sourceIndex='8';break;
		case ' ': debug('spacebar pressed, clearing key control');lastkeyname='';break;
	}
	if (Config.shutdownOnControlSignal) 
	  currentStatus.controlSignal=controlSignal.readSync();
	//debug(currentStatus);
	return;
}

function refreshStatus() {
	// we send some status word requests to the Lyngdorf device.  	
  if (Config.demoMode){
    //debug('get status requested (demo mode)');
  }  else {
	  //debug('get status requested');
      client.write('!PWR?\n');
	  client.write('!VOL?\n');
	  client.write('!SRC?\n');
	  client.write('!SRCNAME?\n');
	  client.write('!MUTE?\n');
	  client.write('!STREAMTYPE?\n');
  }
  //debug(currentStatus);  
}  
  
function getStatus(req, h) {
  if (Config.refreshInterval == 0)
    refreshStatus();
  return currentStatus;
}

function toggleMute(req, h) {
  switch(currentStatus.mute) {
    case 'ON':  client.write('!MUTEOFF\n');break;
    case 'OFF':  client.write('!MUTEON\n');break;
  }
  return true;
}

function volumeDown(req, h) {
  client.write('!VOLDN\n');
  return true;
}

function volumeUp(req, h) {
  client.write('!VOLUP\n');
  return true;
}

function demoUpdate() {
	switch (demoLoopIndex++){
		case 0: debug('demo mode, changing state: power on');currentStatus.power='ON'; currentStatus.sourceIndex=1;currentStatus.sourceName='other source';break;
		case 1:
    case 2: debug('demo mode, changing state: input Spotify');currentStatus.sourceIndex=8;currentStatus.sourceName='Spotify';currentStatus.streamType='Spotify';break;
		case 3: debug('demo mode, changing state: input TV');currentStatus.sourceIndex=4;currentStatus.sourceName='TV';break
		case 4: debug('demo mode, changing state: input TV (MUTED)');currentStatus.sourceIndex=4;currentStatus.sourceName='TV';currentStatus.mute='ON';break
		case 5: debug('demo mode, changing state: power off');currentStatus.power='OFF'; currentStatus.sourceIndex=1; currentStatus.sourceName='1';currentStatus.mute='OFF';break;
	}
  //debug(currentStatus);
  if(demoLoopIndex>5)
    demoLoopIndex=0;
}
	
run();
