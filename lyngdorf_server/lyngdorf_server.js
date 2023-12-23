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

var lastkeyname=' ';

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

var currentStatus={power:'UNKNOWN',volume:'UNKNOWN',sourceIndex:'-1',sourceName:'UNKNOWN',mute:'UNKNOWN',streamType:'UNKNOWN',controlSignal:'UNKNOWN'};


// -- globals --

const gFileName = {
  homePage: 'index.html',
};

// error handler
process.on('unhandledRejection', (err) => {

  console.log(err);
  process.exit(1);
});

process.on('SIGINT', _ => {
  debug('SIGINT received, releasing GPIO control');s
  controlSignal.unexport();
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
        relativeTo: Path.join(__dirname, 'public')
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


  // control: send status request
  server.route({
    method: 'GET',
    path: '/status',
    handler: async function (req, h) { return getStatus(req, h); }
  });

}

// -- helper functions --

function debug(msg) {
  if (!Config.debug)
    return;
  console.log(msg);
}

// start the server
async function run() {
  if(typeof Config.shutdownOnControlSignal === 'undefined')
    Config.shutdownOnControlSignal=false;
    
	readline.emitKeypressEvents(process.stdin);

	if (process.stdin.isTTY)
		process.stdin.setRawMode(true);

    
  var server = createServer();
  setupRoutes(server);
  await server.register(require('@hapi/inert'));  // static file handling
  await server.start();
  debug(`Server running at: ${server.info.uri}`);
  client = new net.Socket();
  client.connect(84, Config.lyngdorfaddress, function() {
  console.log('Lyngdorf device Connected');
  client.write('!VERB(0)?\n');
  });
	client.on('data', function(data) {
	processResponse(Buffer.from(data).toString());
	});
	client.on('close', function() {
	console.log('Connection closed');
	});  
	getStatus();
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

function processResponse(resp){
	var verb='';
	var val='';
	var mode='drop'
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
				  case 'PWR': currentStatus.power=val;break;
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
		case 'o': currentStatus.power='ON';break;
		case 'p': currentStatus.power='OFF';break;
		case '4': currentStatus.sourceName='TV';currentStatus.sourceIndex='4';break;
		case '8': currentStatus.sourceName='Spotify';currentStatus.sourceIndex='8';break;
	}
	if (Config.shutdownOnControlSignal) 
	  currentStatus.controlSignal=controlSignal.readSync();
	debug(currentStatus);
	return;
}

function getStatus(req, h) {
	// we send some status word requests to the Lyngdorf device.
	// note that most likely the responses will not yet be in when this function returns.
  	
  debug('get status requested');
  client.write('!PWR?\n');
  client.write('!VOL?\n');
  client.write('!SRC?\n');
  client.write('!SRCNAME?\n');
  client.write('!MUTE?\n');
  client.write('!STREAMTYPE?\n');
  
  return currentStatus;
  
}

run();
