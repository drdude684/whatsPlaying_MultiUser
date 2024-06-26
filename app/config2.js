/* ***********************************************
 * whatsPlaying_MultiUser
 * by drdude684
 * based on
 * whatsPlaying
 * Copyright (C) Greg Brown, All rights reserved.
 * https://github.com/gregtbrown/whatsPlaying
 * ***********************************************/

// *** DO NOT EDIT THIS FILE ***
// this file is for reference ONLY and NOT used by this app
// copy this file to the required 'myconfig2.js' and make edits there

Config = {

  debug: false,  // show debugging msgs

  serverUrls: ['http://localhost:8000/','http://localhost:8001/'],  // how to connect to our server(s)
  idleMinutes: 5,                          // idle time, in minutes, before we enter idle mode
  sleepMinutes: 0,                         // idle time, in minutes, before we enter sleep mode, or 0 to disable

  // -- options if device has touchscreen/keyboard --

  localLogin: false,                       // show login button (TODO)
  showMouse: true,                         // show the mouse cursor
  showPlayerControls: true,                // show player controls
  preferedPlayer: 'TDAI-1120',             // set to '' to allow all players
  lyngdorfServer: 'http://localhost:8008', // set to '' to indicate no server or compatible amp
  errorTimeout: 5,                         // how many seconds should the error screen be shown
};
