/* ***********************************************
 * whatsPlaying2
 * by drdude684
 * based on
 * whatsPlaying
 * which is Copyright (C) Greg Brown, All rights reserved.
 * https://github.com/gregtbrown/whatsPlaying
 * ***********************************************/

import {getPalette, convertRGBtoHSL, rgbToHex, hslToTxt} from "./palette.js";

var SVGNS = 'http://www.w3.org/2000/svg';
var SVGXLINK = 'http://www.w3.org/1999/xlink';

const spotifyRoutes = {
  playbackState: {type: 'GET', url: 'me/player'},
  //currentPlaying: {type: 'GET', url: 'me/player/currently-playing'},
  //recentlyPlayed: {type: 'GET', url: 'me/player/recently-played?limit=1'},  // items[].track instead of item
  //getPlaylist: {type: 'GET', url: 'playlists/{0}'},  // + playlist_id
  //getPlaylistImage: {type: 'GET', url: 'playlists/{0}/images'},  // + playlist_id
  //getArtist: {type: 'GET', url: 'artists/{0}'},  // + artist_id
  //getDevices: {type: 'GET', url: 'me/player/devices'},
  getQueue: {type: 'GET', url: 'me/player/queue'},
  //getPlaylists: {type: 'GET', url: 'me/playlists'},
  playPlay: {type: 'PUT', url: 'me/player/play{0}'},
  playPause: {type: 'PUT', url: 'me/player/pause{0}'},
  playNext: {type: 'POST', url: 'me/player/next{0}'},
  playPrev: {type: 'POST', url: 'me/player/previous{0}'},

  //// time_range:
  ////   'long_term' (calculated from several years of data and including all new data as it becomes available)
  ////   'medium_term' (approximately last 6 months)
  ////   'short_term' (approximately last 4 weeks)
  //topArtists: {type: 'GET', url: 'me/top/artists?limit={0}&time_range={1}'},
  //topTracks: {type: 'GET', url: 'me/top/tracks?limit={0}&time_range={1}'},
};

var gLoginUrl;
var gCurScreen;
var gUpdateTimer;
var gNowPlaying = {deviceId: 'unknown device', textSizeUpdateRequested:false};
var gLastVal = {playPerc: -1, deviceId: 'unknown device'};  // cache of previous values
var gNowScanning = false;
var gState = 'init';
var gLastState = 'init';
var gStateTimerMap = new Map([
  ["wait",     new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["scan",     new Map([["clock",1],["timeBar",0],["server",1],["playback",0],["scanning",1],["ampScan",1]])],
  ["play",     new Map([["clock",1],["timeBar",1],["server",1],["playback",1],["scanning",0],["ampScan",1]])],
  ["tv",       new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["sleep",    new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["error",    new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["login",    new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["settings", new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",0]])],
]);
var gTimerBlockList=[];
var gCurrentServer = 0;

var gAccessToken;  // store this from last call, but null on error
var gPlayerId;  // store this from last call

var ampStatus = {power:'Undefined',volume:'undefined',sourceIndex:'Unknown',sourceName:'Unknown',mute:'Unknown',streamType:'Unknown'}; // status of associated lyngdorf device

var gUiInfo = {playMeterBackgroundPlay: 'var(--secondary-bg-color)', playMeterBackgroundPause: 'maroon', playListLinesCalculated: false, playListLines: 1, settingsUseAmpBaseString: ''};

var gSettings={};

var gDefaults={};

// run single setInterval timer and handle our own timers manually in that
var gTimer = {
  clock: {
    label: "clock",
    callback: updateClock,
    interval: 500,
    lastTic: 0
  },
  timeBar: {
    label: "timeBar",
    callback: updatePlayerUi,
    interval: 500,
    lastTic: 0
  },
  server: {
    label: "server",
   callback: updateServer,
   interval: 3000,
   lastTic: 0,
  },
  playback: {
    label: "playback",
    callback: updatePlayback,
    interval: 1000,
    lastTic: 0,
  },
  scanning: {
    label: "scanning",
    callback: updateScanning,
    interval: 1000,
    lastTic: 0,
  },
  ampscan: {
    label: "ampScan",
    callback: updateAmpScan,
    interval: 1000,
    lastTic: 0,
  },
};

var gArguments;

// get everything started
window.addEventListener('load', initialize, true);

// track resize events so view is adjusted when required
window.addEventListener('resize', function(event){
 gUiInfo.playListLinesCalculated = false;
 updateViewElements(); 
});

async function initialize() {

  // store initial settings
  gDefaults.useAmp=true;
  elem = document.getElementById('settings_mainColor');
  gDefaults.mainBgColor=elem.value;
  elem = document.getElementById('settings_secondaryColor');
  gDefaults.secondaryBgColor=elem.value;
  
  // load settings from local storage
  let storedSettings=JSON.parse(localStorage.getItem('storedSettings'));
  if(storedSettings!=null) {
    gSettings=storedSettings;
  }
  
  processParameter('serverUrls',['http://localhost/']);
  processParameter('idleMinutes',5);
  processParameter('errorTimeout',10);
  processParameter('showPlayerControls',true);
  processParameter('preferedPlayer','');  
  processParameter('debug',false);
  processParameter('idleMinutes',5);
  processParameter('sleepMinutes',0);
  processParameter('showMouse',true);
  processParameter('lyngdorfServer','');
  
  processParameter('useAmp',!(Config.lyngdorfServer===""))

  if(gSettings!=null) {
    var r = document.querySelector(':root');  
    if(typeof(gSettings.useAmp)!=='undefined')
      Config.useAmp=gSettings.useAmp;
    if(typeof(gSettings.mainBgColor)!=='undefined') {
      elem = document.getElementById('settings_mainColor');
      elem.value=gSettings.mainBgColor;
      r.style.setProperty('--main-bg-color', gSettings.mainBgColor);
    }
    if(typeof(gSettings.secondaryBgColor)!=='undefined') {
      elem = document.getElementById('settings_secondaryColor');
      elem.value=gSettings.secondaryBgColor;
      r.style.setProperty('--secondary-bg-color', gSettings.secondaryBgColor);
    }      
  }
  
  debug(Config);
      
  // trap our hotkeys
  window.addEventListener("keydown", function(event)
  {
    if (gState=='sleep') {  // any key to wake
      setState('wait');
    }
    else if (event.keyCode == 37) {    // left arrow
      uiCmd('prev');
    } else if (event.keyCode == 39) {  // right arrow
      uiCmd('next');
    } else if (event.keyCode == 13) {  // enter
      uiCmd('play');
    } else {
      return;
    }

    event.preventDefault();  // block std handler
  });

  // get login url
  var res = await getLocal('loginUrl');
  //debug(res);
  if (res && res.data)
    gLoginUrl = res.data.url;

  var elem = document.getElementById('body');
  elem.style.cursor = Config.showMouse ? 'auto' : 'none';  

  elem = document.getElementById('loginContent');
  elem.innerHTML = `Log in to Spotify via ${gLoginUrl}`;

  elem = document.getElementById('sleepContent');
  elem.innerHTML = `Wake me at<br><br>${gLoginUrl}`;

  gUiInfo.showPlayInfo = true;
  
  // initial update
  updateClock();
  await updateAmp();
  await updateServer(); // this will also ensure an initial state is set

  setInterval(timerUpdates, 100);
  
  updateViewElements(); //initial sizing etc.

  var elem = document.getElementById('settings_useAmpCheckboxLabel');
  gUiInfo.settingsUseAmpBaseString=elem.innerHTML;
  
}

// -- generic helpers --

function debug(msg) {
  if (!Config.debug)
    return;
    
  if (typeof(msg)=='string') {
    try {
      //const match1 = RegExp('\\d+/(.*:\\d+:\\d+)').exec(new Error().stack.split("\n")[1])[1]; // this works for Safari on MacOS
      //const match2 = RegExp('\\d+/(.*:\\d+:\\d+)').exec(new Error().stack.split("\n")[2])[1]; // this works for Safari on MacOS
      const match1 = RegExp(':(\\d+:\\d+)').exec(new Error().stack.split("\n")[1])[1]; // this works for Safari on MacOS
      const match2 = RegExp(':(\\d+:\\d+)').exec(new Error().stack.split("\n")[2])[1]; // this works for Safari on MacOS
      
      console.log(match2+' -> '+match1+' : '+msg);
    } catch(e) {
      const fullstack = new Error().stack.split("\n"); // this works for Safari on MacOS
      console.log(fullstack[1]);
      
      console.log(msg);
    }
  } else {
    console.log(msg);
  }
  
  /*
   * if(gState=='settings') {
    elem = document.getElementById('settings_line3');
    elem.innerHTML=JSON.stringify(msg);
  }
  */
}

function hasClass(elem, className) { return elem.classList.contains(className); }
function addClass(elem, className) { elem.classList.add(className); }
function removeClass(elem, className) { elem.classList.remove(className); }
function toggleClass(elem, className) { elem.classList.toggle(className); }

function clearChildren(elem)
{
  while (elem.firstChild)
    elem.removeChild(elem.firstChild);
}

function changeSvgIcon(iconElem, newName)
{
  clearChildren(iconElem);

  var icon_use = document.createElementNS(SVGNS, 'use');
  icon_use.setAttributeNS(SVGXLINK, 'href', '#' + newName);
  iconElem.appendChild(icon_use);
}

function format(string, args) {
  if (!string)
    return '';
  return string.replace(/{([0-9]+)}/g, function (match, index) {
    var arg = args[index];
    return typeof arg == 'undefined' ? '' : arg;
  });
};

function processParameter(name,defaultValue) {
  if (typeof(gArguments) == 'undefined')
    gArguments = new URLSearchParams(window.location.search);
  // if argument was passed over URL it takes precedence
  if (gArguments.has(name)) {
    Config[name] = gArguments.get(name);
    // twiddle boolean string values into actual booleans
    if(typeof(defaultValue) == 'boolean')
      Config[name] = (Config[name].toLowerCase() === 'true');
    debug('set parameter '+name+' from provided URL. New value: '+Config[name]);
    return;
  }
  if (typeof(Config[name]) == 'undefined') {
    Config[name] = defaultValue;
    debug('set parameter '+name+' to hard coded default value '+defaultValue);
  }
  
  // now Config[name] exists and has value either from URL, config file, or hard coded default, in that order

}

// -- app functions --

function handleError(err) {
  debug('handling error');
  debug(err);		
  if (!err)
    err = {error: 'unknown'};

  if (!err.error) {
    return;
  } else if (err.error == 'login') {
    setState('login');
  } else {
    var elem = document.getElementById('errorContent');
    elem.innerHTML = err.error;
  }
}

function selectScreen(name) {
  if ( name == gCurScreen)
    return;

  if (gCurScreen) {
    var elem = document.getElementById(gCurScreen);
    removeClass(elem, 'screenOn');
    addClass(elem, 'screenOff');
  }

  gCurScreen = name;

  if (gCurScreen) {
    var elem = document.getElementById(gCurScreen);
    removeClass(elem, 'screenOff');
    addClass(elem, 'screenOn');

    if (gCurScreen === 'playingScreen') {
      // if configured, play controls are always on, even in idle state
      if (Config.showPlayerControls)
        showPlayControls(true);
    }
  }
}

function timerUpdates() {
  var now = Date.now();
  for (let t in gTimer) {
    var timer = gTimer[t];
    if (!gTimerBlockList.includes(timer.label)) {
      if (gStateTimerMap.get(gState).get(timer.label)){
        if (now >= timer.lastTic + timer.interval) {
          timer.count = timer.count + 1;
          timer.callback();
          timer.lastTic = now;
        }
      }
    }
  }
}

function setState(requestedState, data) {
	if (gState==requestedState)
	  return;
	debug('Changing state to '+requestedState);  
  clearState(gState);
	let gPrevState=gState;
	gState=requestedState;

  // re-animate settings icon
  var elem =  document.getElementById('settingsIconBox'); 
  removeClass(elem,'settingsIconBoxAnimation');
  elem.offsetHeight;
  addClass(elem,'settingsIconBoxAnimation');
 
	switch(requestedState){
		case 'wait':{
			activateClock();
		};break;
		case 'scan':{
			activateScan();
		};break;
		case 'play':{
			activatePlay();
		};break;
		case 'tv':{
			activateTv();
		};break;
		case 'sleep':{
			activateSleep();
		};break;
		case 'settings':{
			activateSettings();
		};break;
		case 'error':{
			if (!data)
			data = {error: 'unknown'};			
			if (!data.error) {
				debug('error state requested, but no error apparent, returning to previous state');
				gState=gPrevState;
				return;
			}
			else				
			activateError(data);			
		};break;
		case 'login':{
			selectScreen('loginScreen');
		};break;
	}
}

function clearState() {
	switch(gState){
		case 'play':{
      // play runs its own color scheme that should be reverted when leaving that state
      var r = document.querySelector(':root');  
      r.style.setProperty('--secondary-bg-color', gSettings.secondaryBgColor);
      r.style.setProperty('--main-bg-color', gSettings.mainBgColor);
    };break;
  }    
}

function activateClock(){
  if (!Config.useAmp){
    debug('wait state requested, but no Lyngdorf server configured, switching to scan state');
    setState('scan');
    return;
  } 
	updateClock();
	selectScreen('clockScreen');
	var elem = document.getElementById('clockContent');
	elem.innerHTML='';
}

function activatePlay(){
  // await setWaitStatusInfo();
	selectScreen('playingScreen');
  calculatePlayListLines();
  processPalette('playingAlbumImage');
}

function activateTv(){
	selectScreen('tvScreen');
}

function activateSleep(){
	selectScreen('sleepScreen');
}

function activateError(data){
	selectScreen('errorScreen');
	handleError(data);
  gNowPlaying.errorTime = Date.now();
}

function activateScan(){
  let res = setWaitStatusInfo();
  if (res.error)
    return res;
  res = getPlaybackState();
  if (res.error)
    return res;
  selectScreen('scanningScreen');
}

function activateSettings(){
	selectScreen('settingsScreen');
	var elem = document.getElementById('settings_useAmpCheckboxLabel');
	if (Config.lyngdorfServer!=='') {
    elem.innerHTML=gUiInfo.settingsUseAmpBaseString+'Connect to Lyngdorf amplifier on address '+Config.lyngdorfServer;
//    elem = document.getElementById('settings_useAmpCheckbox');
    elem.checked=!Config.useAmp;
  }
  else
    elem.innerHTML='no Lyngdorf amplifier configured, options to control connection not available';  
}

function closeSettings(){
  // process all values from the settings form before returning to wait state
  
  var r = document.querySelector(':root');  

  var elem = document.getElementById('settings_useAmpCheckbox');
  Config.useAmp=elem.checked;
  
  elem = document.getElementById('settings_mainColor');
  r.style.setProperty('--main-bg-color', elem.value);
  gSettings.mainBgColor=elem.value;
  elem = document.getElementById('settings_secondaryColor');
  r.style.setProperty('--secondary-bg-color', elem.value);
  gSettings.secondaryBgColor=elem.value;
  
  // always save settings to local storage
  gSettings.useAmp=Config.useAmp;
  localStorage.setItem('storedSettings',JSON.stringify(gSettings));
  
  setState('wait');
}

function clearSettings(){
  localStorage.removeItem('storedSettings');

  var r = document.querySelector(':root');  
  elem = document.getElementById('settings_mainColor');
  elem.value=gDefaults.mainBgColor;
  r.style.setProperty('--main-bg-color', gSettings.mainBgColor);
  elem = document.getElementById('settings_secondaryColor');
  elem.value=gDefaults.secondaryBgColor;
  r.style.setProperty('--secondary-bg-color', gSettings.secondaryBgColor);

  Config.useAmp=gDefaults.useAmp;

  activateSettings();// just to propagate useAmp in a consistent way
}

async function updateServer() {
  // if we're sleeping, poll on shouldwake until we're not
  if (gState=='sleep') {
    var res = await getLocal('shouldwake');
    if (res.error) {
      setState('error',res);
      return;
    } else if (!res.data) {  // still sleeping
      return;
    } else {
      gNowPlaying.lastPlayingTime = Date.now();
      setState('wait');
      // fall through
    }
  }
  var curToken = gAccessToken;
  var res = await getLocal('accessToken');
  if (res.error)
    gAccessToken = null;
  else
    gAccessToken = res.data.token;
  if (curToken == null && gAccessToken != null) {  // switch away from error condition
    setState('wait'); // not 100% sure this is the behaviour we should want
  }

  if(res.error) {
    setState('error',res);
    return;
  }
    
}

async function updatePlayback() {
  var res;
  
  if (!gAccessToken || gState=='sleep' || gState=='wait')
    return;

  if (gCurScreen !== 'playingScreen')
    res = await getInitialPlaybackState();
  else
    res = await getPlaybackState();

  if (!res.error && (gState!='sleep') && Config.sleepMinutes) {
    var now = Date.now();
    if (gNowPlaying.isIdle && gNowPlaying.lastPlayingTime && now - gNowPlaying.lastPlayingTime > (Config.sleepMinutes * 60 * 1000)) {
      setState('sleep');
      return;
    }
  }

  if (res.error) {
    setState('error',res);
    return;
  }
}

async function getInitialPlaybackState() {
  gNowPlaying = {};
  var res = await getPlaybackState();
  if (res.error)
    return res;
  if (!gNowPlaying.id) {  // nothing playing, show most recent
    debug('nothing playing yet, activating wait status');
    debug(gNowPlaying);
    res = setWaitStatusInfo();
    if (res.error)
      return res;
    gNowPlaying = res.data;
    gNowPlaying.isIdle = true;
    //gNowPlaying.isPlaying = false;

    updatePlayingScreen(gNowPlaying);
  }

  gNowPlaying.lastPlayingTime = Date.now();  // always set this on start

  return res;
}

function updatePlayerUi() {
  if ((gNowPlaying.textSizeUpdateRequested) ||
        isOverflown(document.getElementById('playingTrackContainer')) ||
        isOverflown(document.getElementById('playingArtistContainer')) ||
        isOverflown(document.getElementById('playingAlbumContainer')))
   {
    let res=true;
    //screen elements should be resized
    let res_temp=resizeText({element: document.getElementById('playingTrack'), parent: document.getElementById('playingTrackContainer')});
    res=res&&res_temp;
    res_temp=resizeText({element: document.getElementById('playingArtist'), parent: document.getElementById('playingArtistContainer')});
    res=res&&res_temp;
    res_temp=resizeText({element: document.getElementById('playingAlbum'), parent: document.getElementById('playingAlbumContainer')});
    res=res&&res_temp;
    // should only do the below if res is true, but for debugging we leave it as is for now
    document.getElementById('playingTrack').style.opacity=1;
    document.getElementById('playingArtist').style.opacity=1;
    document.getElementById('playingAlbum').style.opacity=1;        
    gNowPlaying.textSizeUpdateRequested = res;
  }

  // simulate progress bar between updates
  if (gCurScreen === 'playingScreen')
    updatePlayMeter(gNowPlaying, true);

  if (gLastVal.isPlaying != gNowPlaying.isPlaying) {
    gLastVal.isPlaying = gNowPlaying.isPlaying;
    var elem = document.getElementById('playingPlay');
    changeSvgIcon(elem.children[0], gLastVal.isPlaying ? 'iconPause' : 'iconPlay')
    elem = document.getElementById('playingMeterValue');
    elem.style.background = (gLastVal.isPlaying ? gUiInfo.playMeterBackgroundPlay : gUiInfo.playMeterBackgroundPause);
  }

}

function updateClock() {
  // TODO: option to enable clock

  function pad(input) {
    return input < 10 ? '0' + input : input;
  }

  function timeStr(date) {
    return "".concat(pad(date.getHours()), ':', pad(date.getMinutes()));
  }

  function timeStr_ampm(date) {
    var hr = date.getHours();
    var ampm;

    if ( hr < 12 )
      ampm = 'am';
    else {
      ampm = 'pm';
      if (hr > 12)
        hr -= 12;
    }

    return "".concat(hr, ':', pad(date.getMinutes()), ampm);
  }

  var now = new Date();
  if (now == gLastVal.clock)
    return;

  gLastVal.clock = now;

  clock = document.getElementById('clock');
  if (clock)
    clock.innerHTML = timeStr_ampm(now);

  let bigClock = document.getElementById('bigClockLogin');
  if (bigClock)
    bigClock.innerHTML = timeStr(now);
  bigClock = document.getElementById('bigClockError');
  if (bigClock)
    bigClock.innerHTML = timeStr(now);
  bigClock = document.getElementById('bigClockScanning');
  if (bigClock)
    bigClock.innerHTML = timeStr(now);
  bigClock = document.getElementById('bigClockClock');
  if (bigClock)
    bigClock.innerHTML = timeStr(now);
  bigClock = document.getElementById('bigTvClock');
  if (bigClock)
    bigClock.innerHTML = timeStr(now);
    
  if (gState=='error') {
    var now = Date.now();
    if (now - gNowPlaying.errorTime > (Config.errorTimeout * 1000)) { // show error for 2 minutes, then return to main screen
	  debug('error screen was shown for some time, now returning to our regular programming...');	
      setState('wait');
      return;
    }
   }
    
    
}

async function reinitialize() {
  // get login url
  var res = await getLocal('loginUrl');
  if (res && res.data)
    gLoginUrl = res.data.url;

  let elem = document.getElementById('loginContent');
  elem.innerHTML = `Log in to Spotify via ${gLoginUrl}`;

  elem = document.getElementById('sleepContent');
  elem.innerHTML = `Wake me at<br><br>${gLoginUrl}`;

  if(res.error) {
    setState('error',res);
    return;
  }
  // initial update
  await updateClock();
  await updateServer();
//  await getInitialPlaybackState();
}
	
async function updateScanning() {

  if((ampStatus.sourceIndex!='8')&&(Config.useAmp)){
	  debug('Amplifier input not set to Spotify, so we skip asking Spotify anything');
	  scanMessageElement = document.getElementById('scanningContent');
	  scanMessageElement.innerHTML = 'Spotify not active on amplifier';
	  scanMessageElement = document.getElementById('scanningContent2');
	  scanMessageElement.innerHTML = 'Amp input: '+ampStatus.sourceName;
	  return;
  }

  var now = new Date();
  if (now == gLastVal.scanClock)
    return;
  gCurrentServer=gCurrentServer+1;
  if (gCurrentServer>Config.serverUrls.length-1)
    gCurrentServer=0;
  await updateServer();
  
  gLastVal.scanClock = now;
  
  var scanMessage;

  var res = await spotifyApi(spotifyRoutes.playbackState);
  if (res.error) {
	  setState('error',res);
    return;
  }
  
  var data = res.data;

  if((Config.preferedPlayer!=='')&&Config.useAmp) {
    scanMessage='scanning server '+gCurrentServer+' for the activation of a device named \"'+Config.preferedPlayer+'\"';    
    if ( data != null ) {
      if (data.device) {
        scanMessage=scanMessage+', found: '+data.device.name;
        if (data.device.name===Config.preferedPlayer){
          if (data.is_playing) {
            debug('scan result positive: found server ('+gCurrentServer+') streaming to prefered device '+data.device.name);
            gNowScanning=false;	
            reinitialize();
            setState('play');
          }
          else
            debug('scan result negative: found server ('+gCurrentServer+') set to stream to prefered device '+data.device.name+', but not yet playing');
      } else
          debug('scan result negative: found server ('+gCurrentServer+') streaming to non-prefered device '+data.device.name);
      }
    }
  } else
  {
    scanMessage='scanning server '+gCurrentServer+' for Spotify activity';
    if ( data != null ) {
      if (data.device) {
        scanMessage=scanMessage+', found: '+data.device.name;
        if (data.is_playing) {
          debug('scan result positive: found server ('+gCurrentServer+') streaming to device '+data.device.name);
          gNowScanning=false;	
          reinitialize();
          setState('play');
        }
        else
          debug('scan result negative: found server ('+gCurrentServer+') set to stream to device '+data.device.name+', but not yet playing');
        }
    }
  }
  let scanMessageElement = document.getElementById('scanningContent');
  if (scanMessage)
    scanMessageElement.innerHTML = scanMessage;
    
  scanMessageElement = document.getElementById('scanningContent2');
  scanMessageElement.innerHTML = 'Amp input: '+ampStatus.sourceName;
    
}
	
async function updateAmpScan() {
  var now = new Date();
  if (now == gLastVal.scanClock)
    return;
  gLastVal.scanClock = now;

  if (!Config.useAmp){
    return;
  }
  var res;
  res=await updateAmp();
  if (res.error){
    setState('error',res);
    return;
  }
  
  if (ampStatus.demoMode) {
    // if the amp server is in demo mode, enter a pseudo demo mode of our own, where spotify 
    // activity is shown for iPhones associated with the running servers
    debug('setting pseudo demo mode');
    Config.preferedPlayer='';
  }
  
  
  var muteLogo = document.getElementById("muteLogoBox");
  if (ampStatus.mute==='ON') {
	  if (muteLogo.style.display !== "block") {
		  debug('showing');
		  muteLogo.style.display = "block";
	  }
  } else if (muteLogo.style.display === "block") {
		debug('hiding');
		muteLogo.style.display = "none";
  }
  
  if(ampStatus.power=='OFF'){
	  setState('wait');
	  return;
  }

  if ((ampStatus.sourceIndex=='4')&&(gState!='tv')) {
		  setState('tv');
		  return;
	  }
	  
  if ((ampStatus.sourceIndex!='4')&&(gState=='tv')) {
		  setState('scan');
		  return;
	  }
	  
  if((ampStatus.power=='ON')&&(gState=="wait")){
	  debug('amp is on, switching to scanning for spotify');
	  setState('scan');
	  return;
  }   
  
}

function showPlayControls(show) {
  //var elem = document.getElementById('playingControls');
  //elem.style.display = show ? 'inline-block' : 'none';
  var elem = document.getElementById('controlBox');
  elem.style.display = show ? 'flex' : 'none';
  if (Config.useAmp) {
    elem = document.getElementById('volumeControls');
    elem.style.display = show ? 'flex' : 'none';
  }
    
  Config.showPlayControls = show;
}

function showPlayMeter(show) {
  var elem = document.getElementById('playingMeter');
  elem.style.opacity = show ? '1' : '0';
}

function showPlayInfo(show) {
  if (gUiInfo.showPlayInfo == show)
    return;
  var elem = document.getElementById('playingInfo');
  elem.style.display = show ? 'flex' : 'none';
  var elem = document.getElementById('playListInfo');
  elem.style.display = show ? 'none' : 'flex';
  gUiInfo.showPlayInfo = show;
}

function updatePlayMeter(data, interpolate) {
  if (!data || !data.isPlaying)
    return;

  var progress = data.progress;
  if (interpolate)
    progress += Date.now() - data.time;  // adjust by time elapsed since last update

  var perc = (progress * 100) / data.duration;
  if (perc > 100)
    perc = 100;

  if (perc == gLastVal.playPerc)
    return;

  gLastVal.playPerc = perc;

  var elem = document.getElementById('playingMeterValue');
  elem.style.width = `${isNaN(perc) ? 0 : perc}%`;

  showPlayMeter(true);
}

function waitForImage(imgElem) {
    return new Promise(res => {
        if (imgElem.complete) {
            return res();
        }
        imgElem.onload = () => res();
        imgElem.onerror = () => res();
    });
}

async function updatePlayingScreen(data) {
  function setText(id, text) {
    var elem = document.getElementById(id);
    if (elem)
      elem.innerHTML = text ? text : '';
  }

  setText('playingTrack', data.track);
  setText('playingAlbum', data.album);
  setText('playingArtist', data.artist);
  setText('playingDate', data.date);
  setText('playingPlaylist', data.playlist);
  
  updatePlayMeter(gNowPlaying);

  if (data.albumImage != gLastVal.albumImage) {
    gLastVal.albumImage = data.albumImage;
    var elem = document.getElementById('playingAlbumImage');
    if (elem) {
      if (!data.albumImage)
        elem.style.opacity = '0';
      else {
        elem.src = data.albumImage;
        elem.style.opacity = '1';        
        await waitForImage(elem);
        processPalette('playingAlbumImage');
      }
    }
    elem = document.getElementById('playingAlbumImage2');
    if (elem) {
      if (!data.albumImage)
        elem.style.opacity = '0';
      else {
        elem.src = data.albumImage;
        elem.style.opacity = '0.2';        
        await waitForImage(elem);
        processPalette('playingAlbumImage');
      }
    }
  }
  
}

function getArtistName(artists) {
  var artist = '';

  // concat artist names
  for (var i = 0; i < artists.length; i++) {
    if ( i > 0 )
      artist += ', ';
    artist += artists[i].name;
  }

  return artist;
}

function getYearFromDate(date, precision) {
  // TODO: currently assuming type 'month' is yyyy-mm, but tbd
  if (!date)
    return '';
  if (precision !== 'year') {
    date = date.split('-')[0];  // yyyy-mm-dd
  }
  return date;
}

function getAlbumImage(images, largest = true) {
  // get largest/smallest album image
  var image;
  var w = largest ? 0 : 100000;

  for (var i = 0; i < images.length; i++) {
    var img = images[i];
    if ((largest && img.width > w) || (!largest && img.width < w)) {
      image = img.url;
      w = img.width;
    }
  }

  if (!image)
    image = './music.png';
  return image;
}

async function getPlaybackState() {
  
  if(gState!="play") {
    return {data:null}
  }
    
  // using 'playbackState' instead of 'currentPlaying' so we can get the current playback device
  var res = await spotifyApi(spotifyRoutes.playbackState);

  if (res.error)
    return res;
  var data = res.data;

  var now = Date.now();
  var prevPlaying = gNowPlaying.isPlaying;
  var prevId = gNowPlaying.id;

  if ( data == null ) {
    gNowPlaying.isPlaying = false;
    prevId = !gNowPlaying.isPlaying;  // force a change
  } else {

    if (data.device) {
      gNowPlaying.deviceId = data.device.id;
      gLastVal.deviceId = data.device.id;
      if (Config.preferedPlayer!=='')
		  if ((Config.preferedPlayer!==data.device.name)&&Config.useAmp){
			  // not prefered device, should now go back to scanning mode
			  debug('current device not the prefered type, returning to scanning mode');
			  setState('scan')
			  return {data:null}
		  }
    }
    
    //if((ampStatus.streamType!='2')||(ampStatus.sourceIndex!='8')){
    if((Config.preferedPlayer!=='')&&(ampStatus.sourceIndex!='8')&&Config.useAmp){
      debug('amplifier is not streaming spotify, returning to scanning mode');		
      setState('scan');// perhaps consider returning to 'wait' state
      return {data:null};
    }

    var track = data.item;
    if (!track) {
      gNowPlaying.name = 'unknown';
    } else {
      var album = track.album;
      var id = track.uri;
      var oldId = gNowPlaying.id;

      if (id != oldId) {
        //debug("context:")
        //debug(data.context)
        
        // maybe get playlist name
        gNowPlaying.playlist = 'Playlist not retrieved';

        if ( data.context && (data.context.type == 'playlist' || data.context.type == 'album') && data.context.href ) {          
          var pl = await spotifyApiDirect('GET', data.context.href);
          if ( pl.data ) {
            gNowPlaying.playlist = pl.data.name;
          }
          else {
            // as of november 2024 spotify is blocking API access to endpoints which contain spotify-generated playlists
            // the below is a workaround by asking the server to find the title of the webpage which is still provided for such playlists
                        
            const externalURL = data.context.external_urls.spotify;
            debug(externalURL)
            
            // Requesting external url
            try {
              await getLocal('getTitle'+'?url='+externalURL)
                .then(function(title) {
                  debug('getTitle response:')
                  debug(title)
                  if (title.data.title.length>0) {
                    gNowPlaying.playlist = title.data.title.replace(" by Spotify | Spotify"," (by Spotify)")
                  }
                  else {   
                    gNowPlaying.playlist = "Could not obtain playlist/album name"
                  }
                })
              } catch(error) {
                debug(error)
                gNowPlaying.playlist = "Could not obtain playlist/album name"
              }            
          }
        }
        
        gNowPlaying.type = data.currently_playing_type;  // e.g. 'track'
        gNowPlaying.id = id;                             // track ID
        gNowPlaying.track = track.name;
        gNowPlaying.album = album.name;
        gNowPlaying.artist = getArtistName(track.artists); 

        document.getElementById('playingTrack').style.opacity=0;
        document.getElementById('playingArtist').style.opacity=0;
        document.getElementById('playingAlbum').style.opacity=0;        
        gNowPlaying.textSizeUpdateRequested = true;

        gNowPlaying.date = getYearFromDate(album.release_date, album.release_date_precision);
        gNowPlaying.explicit = track.explicit;
        gNowPlaying.popularity = track.popularity;
        //gNowPlaying.playlist = playlist;
        gNowPlaying.albumImage = getAlbumImage(album.images);
        gNowPlaying.duration = track.duration_ms;

        // get queue
        gNowPlaying.queue = await getQueue();
        if (gNowPlaying.queue.length >0 ) {
          var newInnerHTML='<ol onclick="playQueueItem(event.target)">';
          var count=0;
          for (let item of gNowPlaying.queue) {
            //debug(item.track);
            if (++count < gUiInfo.playListLines) // should count actual lines, not entries
              newInnerHTML = newInnerHTML+'<li>'+item.track+'</li>\r\n';            
          }          
          newInnerHTML = newInnerHTML+'</ol>\r\n';
          var elem=document.getElementById('playListBox');
          elem.innerHTML = newInnerHTML;
        }
        else {
          debug("No queue available")
        }
      }
    }

    // always update play meter info
    gNowPlaying.progress = data.progress_ms;
    gNowPlaying.isPlaying = data.is_playing;
    gNowPlaying.time = now;  // time of update
    gNowPlaying.isIdle = false;

    if (gNowPlaying.isPlaying)
      gNowPlaying.lastPlayingTime = now;  // last time we saw something playing

    // debug(gNowPlaying);

    if (id == oldId) {
      updatePlayMeter(gNowPlaying);
    } else {
      debug(gNowPlaying);
      updatePlayingScreen(gNowPlaying);
    }
  }

  // check if we need to reset our update timer
  if (gNowPlaying.expectingChange &&
      (gTimer.playback.count >= gNowPlaying.expectingChange ||
       gNowPlaying.isPlaying != prevPlaying || gNowPlaying.id != prevId)) {
    gNowPlaying.expectingChange = false;
    gTimer.playback.interval = gTimer.playback.nextInterval;
  }

  // check if idle time elapsed
  if (!gNowPlaying.isPlaying && !gNowPlaying.isIdle &&
      gNowPlaying.lastPlayingTime && (now - gNowPlaying.lastPlayingTime > (Config.idleMinutes * 60 * 1000))) {
    gNowPlaying.isIdle = true;
    showPlayMeter(false);
  }

  // update timer logic towards end of song so display is refreshed as soon as next song starts

  if (gNowPlaying.duration-gNowPlaying.progress<3000) {
    gTimer.playback.nextInterval = 1000;
    gTimer.playback.interval = 250;
  }
  
  if (prevId != gNowPlaying.id) {
    if (gTimer.playback.nextInterval)
      gTimer.playback.interval = gTimer.playback.nextInterval;    
  }
  
  
  return {data: gNowPlaying};
}

function setWaitStatusInfo() {

  debug('setting data values which reflect wait status')
  
  var rtrn = {};

  rtrn.type = 'track';  // e.g. 'track'
  rtrn.id = false;     // track ID
  rtrn.track = 'Waiting for track...';
  rtrn.album = 'Waiting for album...';
  rtrn.artist = 'Waiting for artist...';
  rtrn.date = '';
  rtrn.explicit = false;
  rtrn.popularity = 0;
  rtrn.albumImage = null; // perhaps this will not work
  rtrn.duration = 1;
  rtrn.time = Date.now();
  debug(rtrn);

  return {data: rtrn};
}

async function getQueue() {
  var res = await spotifyApi(spotifyRoutes.getQueue);
  if (res.error)
    return res;

  var list = [];
  var data = res.data;

  if (data && data.queue) {
    var items = data.queue;
    for (var i = 0; i < items.length; i++) {
      var track = items[i];
      var album = track.album;

      var entry = {};
      entry.type = track.type;  // e.g. 'track'
      entry.id = track.uri;     // track ID
      entry.track = track.name;
      entry.album = album.name;
      entry.artist = getArtistName(track.artists);
      entry.date = getYearFromDate(album.release_date, album.release_date_precision);
      entry.explicit = track.explicit;
      entry.popularity = track.popularity;
      entry.albumImage = getAlbumImage(album.images, false);
      entry.duration = track.duration_ms;

      list.push(entry);
    }
  }

  return list;
}

export async function playQueueItem(track) {
  
  var timeOut=50;
  
  track=String(track.outerHTML);
  if (track.substring(0,4)!=='<li>') {
    debug('not a valid track item to jump to');
    return;
  }
  track=track.substring(4,track.length-5);
  debug('jumping to queue item: '+track);
  
  // find which item to jump to
  
  var index=0;
  for (item of gNowPlaying.queue) {    
    ++index;
    //debug(item.track);
    if(item.track===track) {
      //debug('found it! ' + index);
      break;
    }
  }         
  
  if (index==gNowPlaying.queue.length) {
    debug('could not find track index, aborting');
    return;
  }
  
  // now skip to relevant track
  
  //temporarily disable those timers that could generate API queries
  
  var prevTimerBlockList=gTimerBlockList;
  gTimerBlockList = ["server","playback","scanning","timeBar"];
  
  // now start skipping
  
  var arg = gLastVal.deviceId ? `?device_id=${gLastVal.deviceId}` : null;
  var res;
  for(let i=0;i<index;++i) {
    debug('skipping ('+(i+1)+'/'+index+')');
    var errCount=0
    do {
      res = await spotifyApi(spotifyRoutes.playNext, arg);   
      //debug('>>> (now playing: '+gNowPlaying.track+')');
      if (res.error) {        
        debug('error occured while skipping, retrying');
        ++errCount
        await new Promise(r => setTimeout(r, timeOut));
      }
    } while (res.error&&(errCount<3));

    if( errCount >= 3) {
      debug('could not skip to requested entry, aborting');
      // this is not serious enough to report to the user as an error
      //setState('error',res);
      //return things to as they were
      gTimerBlockList = prevTimerBlockList;
      return;
    }
        
    await new Promise(r => setTimeout(r, timeOut));    
  }   
  
  //return things to as they were
  gTimerBlockList = prevTimerBlockList;
}

async function spotifyApiDirect(type, route) {
  if (!gAccessToken) {
    return {error: 'login'};
  }
  try {
    var res = await fetch(route, {method: type, headers: {Authorization: 'Bearer ' + gAccessToken, Accept: 'application/json', 'Content-Type': 'application/json'}});

    if ( res.status >= 200 && res.status < 300 )
    {
      // non-200's are a success call but have invalid data, e.g. not-playing
      if (res.status != 200)
        return {data: null};
      
      let content_type=res.headers.get('content-type')
      if (content_type == null) 
        return {data:null}

      if (content_type.includes('application/json'))
        return {data: await res.json()}
      else
        return {data: await res.text()}

    }

    // TODO: response.status 401 means expired token, might need to force server to renew
    return {error: `spotify: ${res.status}`};
  } catch(e) {
    return {error: `spotify: ${e.message}`};
  }    
}

async function spotifyApi(route, ...args) {
  var baseUri = 'https://api.spotify.com/v1/';
  var type = 'GET';
  var url = route;

  if (typeof(route) === 'object') {
    type = route.type;
    url = route.url;
  }

  url = format(url, args);
  
  return spotifyApiDirect(type, baseUri + url);
}

async function getLocal(route) {
  try {
    var baseUri = Config.serverUrls[gCurrentServer];
    var res = await fetch(baseUri + route);
    if ( res.status == 200 ) {
      res = await res.json();
      if (res.error)
        return res;
      return {data: res};
    }

    return {error: `local server returned error: ${res.status}`};
  } catch(e) {
    return {error: `local server problem: ${e.message}`};
  }
}

async function ampCommand(route) {
  try {
    var baseUri = Config.lyngdorfServer;
    var res = await fetch(baseUri + route);
    if ( res.status == 200 ) {
      res = await res.json();
      if (res.error)
        return res;
      return res;
    }
    return {error: `lyngdorf server returned error: ${res.status}`};
  } catch(e) {
    return {error: `lyngdorf server problem: ${e.message}`};
  }
}

async function updateAmp() {
  if (!Config.useAmp){
    // return as if all is well
    ampStatus.power='ON';
    ampStatus.streamType='2';
    return;
  }
  let res=await ampCommand('/status');
  ampStatus=res;
  return res;
}

export function uiCmd(cmd) {

  var arg = gLastVal.deviceId ? `?device_id=${gLastVal.deviceId}` : null;
  
  //temporarily disable those timers that could generate API queries
  
  var prevTimerBlockList=gTimerBlockList;
  //gTimerBlockList = ["server","playback","scanning","timeBar"];
  gTimerBlockList = ["server","scanning","timeBar"];
  
  switch(cmd) {
    case 'play':           spotifyApi(gNowPlaying.isPlaying ? spotifyRoutes.playPause : spotifyRoutes.playPlay, arg);break;
    case 'next':           spotifyApi(spotifyRoutes.playNext, arg);break;
    case 'prev':           spotifyApi(spotifyRoutes.playPrev, arg);break;
    case 'mute':           ampCommand('/toggleMute');break;
    case 'volDown':        ampCommand('/volumeDown');break;
    case 'volUp':          ampCommand('/volumeUp');break;
    case 'toggleControls': showPlayControls(!Config.showPlayControls); break;
    case 'togglePlayInfo': showPlayInfo(!gUiInfo.showPlayInfo);break;
    case 'settings':       if (gState !== 'settings') setState('settings');break;
    case 'closeSettings':  if (gState === 'settings') closeSettings();break;
    case 'clearSettings':  clearSettings();break;
  }
  
  gTimerBlockList=prevTimerBlockList;

  updatePlayback();
  
  // bump up the refresh rate until we get a change
  gTimer.playback.nextInterval = 3000;
  gTimer.playback.interval = 250;
  gTimer.playback.count = 0;
  gNowPlaying.expectingChange = 10;  // max count fallback
  
}

function calculatePlayListLines() {
    
  if (gUiInfo.playListLinesCalculated)
    return;
  var pi=gUiInfo.showPlayInfo;
  showPlayInfo(false);
  var elem =  document.getElementById('playListBox'); 
  elem.innerHTML='A<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\nA<br>\r\n';
  var computedFontSize = parseInt(window.getComputedStyle(elem).fontSize);
  if ((computedFontSize>0)&&(elem.offsetHeight>0)) {
    gUiInfo.playListLines = Math.floor(elem.offsetHeight/(computedFontSize*1.2));
    gUiInfo.playListLinesCalculated = true;
  }
  elem.innerHTML='';
  showPlayInfo(pi);
}

function updateViewElements () {
  if (document.documentElement.clientWidth>document.documentElement.clientHeight) {
    var elem = document.getElementById("playingContent");
    removeClass(elem, 'playingContent_portrait');
    addClass(elem, 'playingContent_landscape');
  } else {
    var elem = document.getElementById("playingContent");
    removeClass(elem, 'playingContent_landscape');
    addClass(elem, 'playingContent_portrait');
  }
  
  calculatePlayListLines();
  resizeText({element: document.querySelector('.playingTrack'), parent: document.querySelector('.playingTrackContainer')});
  resizeText({element: document.querySelector('.playingArtist'), parent: document.querySelector('.playingArtistContainer')});
  resizeText({element: document.querySelector('.playingAlbum'), parent: document.querySelector('.playingAlbumContainer')});
  showPlayInfo(gUiInfo.showPlayInfo);
 
  updatePlayingScreen(gNowPlaying); 

}

const isOverflown = ({ clientHeight, scrollHeight }) => scrollHeight > 1.01*clientHeight

const resizeText = ({ element, parent }) => {
  //debug('resizing: '+parent.scrollHeight+' > '+parent.clientHeight);
  let i = 10 // let's start small
  let overflow = false
  let unit = 'px'
  const maxSize = 100 // very huge text size

  while (!overflow && i < maxSize) {
    element.style.fontSize = `${i}${unit}`
    //debug(i+': '+parent.scrollHeight+' > '+parent.clientHeight);
    overflow = isOverflown(parent)
    if (!overflow) i++
  }

  // revert to last state where no overflow happened:
  element.style.fontSize = `${i - 1}${unit}`
  //debug('result: '+parent.scrollHeight+' > '+parent.clientHeight);
  return isOverflown(parent);
}

function processPalette (elementId) {
  getPalette(elementId)
    .then((quantColors)=>{
      let hslColors=convertRGBtoHSL(quantColors);
      let saturations=hslColors.map(c => c.s);
      let darkSats=saturations.slice(0,8);
      let maxSatDarkIndex = darkSats.indexOf(Math.max(...darkSats.filter(Boolean)));// the filter.Boolean removes undefined values before finding max
      if(maxSatDarkIndex<0) maxSatDarkIndex=0;
      let lightSats=saturations.slice(8,16);
      let lumThreshold=80;
      let lightSatsCandidates=hslColors.slice(8,16).filter(c=>(c.l<lumThreshold)).map(c=>c.s).filter(Boolean);
      let maxSatLightIndex = lightSats.indexOf(Math.max(...lightSatsCandidates));
      if(maxSatLightIndex<0) maxSatLightIndex=7;
      
      // make start color of gradient dark enough that white text will show on top of it
      let darkColor=quantColors[maxSatDarkIndex];
      let darkColorLum=0.2126 * darkColor.r + 0.7152 * darkColor.g + 0.0722 * darkColor.b;
      if(darkColorLum>20) {
        let factor=20/darkColorLum;
        darkColor.r=Math.round(factor*darkColor.r);
        darkColor.g=Math.round(factor*darkColor.g);
        darkColor.b=Math.round(factor*darkColor.b);
      }
      var r = document.querySelector(':root');  
      r.style.setProperty('--secondary-bg-color', rgbToHex(quantColors[maxSatLightIndex+8]));
      r.style.setProperty('--main-bg-color', rgbToHex(darkColor));

      document.getElementById('playPaletteItem0').style.background=rgbToHex(quantColors[0]);
      document.getElementById('playPaletteItem1').style.background=rgbToHex(quantColors[1]);
      document.getElementById('playPaletteItem2').style.background=rgbToHex(quantColors[2]);
      document.getElementById('playPaletteItem3').style.background=rgbToHex(quantColors[3]);
      document.getElementById('playPaletteItem4').style.background=rgbToHex(quantColors[4]);
      document.getElementById('playPaletteItem5').style.background=rgbToHex(quantColors[5]);
      document.getElementById('playPaletteItem6').style.background=rgbToHex(quantColors[6]);
      document.getElementById('playPaletteItem7').style.background=rgbToHex(quantColors[7]);
      document.getElementById('playPaletteItem8').style.background=rgbToHex(quantColors[8]);
      document.getElementById('playPaletteItem9').style.background=rgbToHex(quantColors[9]);
      document.getElementById('playPaletteItem10').style.background=rgbToHex(quantColors[10]);
      document.getElementById('playPaletteItem11').style.background=rgbToHex(quantColors[11]);
      document.getElementById('playPaletteItem12').style.background=rgbToHex(quantColors[12]);
      document.getElementById('playPaletteItem13').style.background=rgbToHex(quantColors[13]);
      document.getElementById('playPaletteItem14').style.background=rgbToHex(quantColors[14]);
      document.getElementById('playPaletteItem15').style.background=rgbToHex(quantColors[15]);

      document.getElementById('playPaletteItem0').innerHTML=" 0:"+hslToTxt(hslColors[0]);
      document.getElementById('playPaletteItem1').innerHTML=" 1:"+hslToTxt(hslColors[1]);
      document.getElementById('playPaletteItem2').innerHTML=" 2:"+hslToTxt(hslColors[2]);
      document.getElementById('playPaletteItem3').innerHTML=" 3:"+hslToTxt(hslColors[3]);
      document.getElementById('playPaletteItem4').innerHTML=" 4:"+hslToTxt(hslColors[4]);
      document.getElementById('playPaletteItem5').innerHTML=" 5:"+hslToTxt(hslColors[5]);
      document.getElementById('playPaletteItem6').innerHTML=" 6:"+hslToTxt(hslColors[6]);
      document.getElementById('playPaletteItem7').innerHTML=" 7:"+hslToTxt(hslColors[7]);
      document.getElementById('playPaletteItem8').innerHTML=" 8:"+hslToTxt(hslColors[8]);
      document.getElementById('playPaletteItem9').innerHTML=" 9:"+hslToTxt(hslColors[9]);
      document.getElementById('playPaletteItem10').innerHTML=" 10:"+hslToTxt(hslColors[10]);
      document.getElementById('playPaletteItem11').innerHTML=" 11:"+hslToTxt(hslColors[11]);
      document.getElementById('playPaletteItem12').innerHTML=" 12:"+hslToTxt(hslColors[12]);
      document.getElementById('playPaletteItem13').innerHTML=" 13:"+hslToTxt(hslColors[13]);
      document.getElementById('playPaletteItem14').innerHTML=" 14:"+hslToTxt(hslColors[14]);
      document.getElementById('playPaletteItem15').innerHTML=" 15:"+hslToTxt(hslColors[15]);
    })
};
