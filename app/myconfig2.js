/* ***********************************************
 * whatsPlaying
 * Copyright (C) Greg Brown, All rights reserved.
 * https://github.com/gregtbrown/whatsPlaying
 * ***********************************************/

// *** DO NOT EDIT THIS FILE ***
// this file is for reference ONLY and NOT used by this app
// copy this file to the required 'myconfig.js' and make edits there

Config = {

  debug: true,  // show debugging msgs

  serverUrls: ['http://localhost:8000/','http://localhost:8001/'],  // how to connect to our server
  idleMinutes: 5,                  // idle time, in minutes, before we enter idle mode
  sleepMinutes: 0,                // idle time, in minutes, before we enter sleep mode, or 0 to disable

  // -- options if device has touchscreen/keyboard --

  localLogin: false,          // show login button (TODO)
  showMouse: false,            // show the mouse cursor
  showPlayerControls: false,  // show player controls

  preferedPlayer: 'iPad',  // set to '' to allow all players
  lyngdorfServer: '',
};
