/* ***********************************************
 * whatsPlaying
 * Copyright (C) Greg Brown, All rights reserved.
 * https://github.com/gregtbrown/whatsPlaying
 * ***********************************************/

// additional code by drdude684

var SVGNS = 'http://www.w3.org/2000/svg';
var SVGXLINK = 'http://www.w3.org/1999/xlink';

const spotifyRoutes = {
  playbackState: {type: 'GET', url: 'me/player'},
  currentPlaying: {type: 'GET', url: 'me/player/currently-playing'},
  recentlyPlayed: {type: 'GET', url: 'me/player/recently-played?limit=1'},  // items[].track instead of item
  getPlaylist: {type: 'GET', url: 'playlists/{0}'},  // + playlist_id
  getPlaylistImage: {type: 'GET', url: 'playlists/{0}/images'},  // + playlist_id
  getArtist: {type: 'GET', url: 'artists/{0}'},  // + artist_id
  getDevices: {type: 'GET', url: 'me/player/devices'},
  playPlay: {type: 'PUT', url: 'me/player/play{0}'},
  playPause: {type: 'PUT', url: 'me/player/pause{0}'},
  playNext: {type: 'POST', url: 'me/player/next{0}'},
  playPrev: {type: 'POST', url: 'me/player/previous{0}'},

  // time_range:
  //   'long_term' (calculated from several years of data and including all new data as it becomes available)
  //   'medium_term' (approximately last 6 months)
  //   'short_term' (approximately last 4 weeks)
  topArtists: {type: 'GET', url: 'me/top/artists?limit={0}&time_range={1}'},
  topTracks: {type: 'GET', url: 'me/top/tracks?limit={0}&time_range={1}'},
};

var gLoginUrl;
var gCurScreen;
var gUpdateTimer;
var gNowPlaying = {deviceId: 'unknown device'};
var gLastVal = {playPerc: -1, deviceId: 'unknown device'};  // cache of previous values
var gNowScanning = false;
var gState = 'init';
var gLastState = 'init';
const gStateTimerMap = new Map([
  ["wait",  new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["scan",  new Map([["clock",1],["timeBar",0],["server",1],["playback",0],["scanning",1],["ampScan",1]])],
  ["play",  new Map([["clock",1],["timeBar",1],["server",1],["playback",1],["scanning",0],["ampScan",1]])],
  ["tv",    new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["sleep", new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["error", new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
  ["login", new Map([["clock",1],["timeBar",0],["server",0],["playback",0],["scanning",0],["ampScan",1]])],
]);
var gTimerMap=gStateTimerMap.get("wait");
var gCurrentServer = 0;

var gAccessToken;  // store this from last call, but null on error
var gPlayerId;  // store this from last call

var ampStatus = {power:'Undefined',volume:'undefined',sourceIndex:'Unknown',sourceName:'Unknown',mute:'Unknown',streamType:'Unknown'}; // status of associated lyngdorf device

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
    callback: updatePayerUi,
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
    interval: 3000,
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


// get everything started
window.addEventListener('load', initialize, true);


async function initialize() {
	
  if(!Config.serverUrls)
    Config.serverUrls=['http://localhost/'];
    	
  for (i in Config.serverUrls) {	
	  if (!Config.serverUrls[i].endsWith('/'))
		Config.serverUrls[gCurrentServer] += '/';
	}

  if (!Config.idleMinutes)
    Config.idleMinutes = 5;
  
  if(!Config.errorTimeout)
    Config.errorTimeOut=60;
      
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
  
  // initial update
  updateClock();
  await updateAmp();
  await updateServer();

  setInterval(timerUpdates, 1000);
  
  // always start by showing the clock
  setState('wait');
}

// -- generic helpers --

function debug(msg) {
  if (!Config.debug)
    return;
  console.log(msg);
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


// -- app functions --

function uiCmd(cmd) {

  var arg = gLastVal.deviceId ? `?device_id=${gLastVal.deviceId}` : null;

  if (cmd === 'play') {
    spotifyApi(gState=='play' ? spotifyRoutes.playPause : spotifyRoutes.playPlay, arg);
    // TODO: this can cause bounce if we get an update before it actually gets set
    //gNowPlaying.isPlaying = !gNowPlaying.isPlaying;
  } else if (cmd === 'next') {
    spotifyApi(spotifyRoutes.playNext, arg);
  } else if (cmd === 'prev') {
    spotifyApi(spotifyRoutes.playPrev, arg);
  } else {
    return;
  }

  // bump up the refresh rate until we get a change
  gTimer.playback.nextInterval = 3000;
  gTimer.playback.interval = 500;
  gTimer.playback.count = 0;
  gNowPlaying.expectingChange = 10;  // max count fallback
}

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
  for (t in gTimer) {
    var timer = gTimer[t];
    if (gStateTimerMap.get(gState).get(timer.label)){
		if (now >= timer.lastTic + timer.interval) {
		  timer.count = timer.count + 1;
		  timer.callback();
		  timer.lastTic = now;
	  }
    }
  }
}

function activateClock(){
	updateClock();
	selectScreen('clockScreen');
	var elem = document.getElementById('clockContent');
	elem.innerHTML='';
}

function activatePlay(){
	selectScreen('playingScreen');
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
  getPlaybackState();
  selectScreen('scanningScreen');
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
    res = await getInitialPlaybackState();
    if (!res.error){
      //setState('play');
      // should check whether this behavior is still required now that we are running via a state machine
    }
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
debug('nothing playing yet, fetching most recent');
debug(gNowPlaying);
    res = await getRecentlyPlayed();
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

function updatePayerUi() {
  // simulate progress bar between updates
  if (gCurScreen === 'playingScreen')
    updatePlayMeter(gNowPlaying, true);

  if (gLastVal.isPlaying != gNowPlaying.isPlaying) {
    gLastVal.isPlaying = gNowPlaying.isPlaying;
    var elem = document.getElementById('playingPlay');
    changeSvgIcon(elem.children[0], gLastVal.isPlaying ? 'iconPause' : 'iconPlay')
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

  bigClock = document.getElementById('bigClockLogin');
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

  elem = document.getElementById('loginContent');
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
  await getInitialPlaybackState();
}
	
async function updateScanning() {
  if (Config.preferedPlayer===''){
	  setState('play');
	  return;
  }
  if(ampStatus.sourceIndex!='8'){
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
  
  var scanMessage='scanning server '+gCurrentServer+' for the activation of a device named \"'+Config.preferedPlayer+'\"';

  var res = await spotifyApi(spotifyRoutes.playbackState);
  if (res.error) {
	setState('error',res);
    return;
  }
  var data = res.data;

  if ( data == null ) {
  } else {
    if (data.device) {
	  scanMessage=scanMessage+', found: '+data.device.name;
      if (data.device.name===Config.preferedPlayer){
		  debug('scan result positive: found server ('+gCurrentServer+') streaming to prefered device '+data.device.name);
		  gNowScanning=false;	
		  reinitialize();
		  setState('play');
	  } else
        debug('scan result negative: found server ('+gCurrentServer+') streaming to non-prefered device '+data.device.name);
    }
  }
  scanMessageElement = document.getElementById('scanningContent');
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

  debug('checking amp status');
  
  var res;
  res=await updateAmp();
  if (res.error){
    setState('error',res);
    return;
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
  var elem = document.getElementById('playingControls');
  elem.style.display = show ? 'block' : 'none';
}

function showPlayMeter(show) {
  var elem = document.getElementById('playingMeter');
  elem.style.opacity = show ? '1' : '0';
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

function updatePlayingScreen(data) {
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

function getGenre(genres) {
  var genre = '';

  // concat genres
  for (var i = 0; i < genres.length; i++) {
    if ( i > 0 )
      genre += ', ';
    genre += genres[i];
  }

  return genre;
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
		  if (Config.preferedPlayer!==data.device.name){
			  // not prefered device, should now go back to scanning mode
			  debug('current device not the prefered type, returning to scanning mode');
			  setState('scan');
			  return {data:null};
		  }
    }
    
    //if((ampStatus.streamType!='2')||(ampStatus.sourceIndex!='8')){
    if((Config.preferedPlayer!=='')&&(ampStatus.sourceIndex!='8')){
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
        // maybe get playlist name
        var playlist;
        if ( data.context && data.context.type == 'playlist' && data.context.href ) {
          var pl = await spotifyApiDirect('GET', data.context.href);
          if ( pl ) {
            playlist = pl.data.name;
          }
        }

        gNowPlaying.type = data.currently_playing_type;  // e.g. 'track'
        gNowPlaying.id = id;                             // track ID
        gNowPlaying.track = track.name;
        
        gNowPlaying.album = album.name;
        
        gNowPlaying.artist = getArtistName(track.artists); 
        
        gNowPlaying.date = getYearFromDate(album.release_date, album.release_date_precision);
        gNowPlaying.explicit = track.explicit;
        gNowPlaying.popularity = track.popularity;
        gNowPlaying.playlist = playlist;
        gNowPlaying.albumImage = getAlbumImage(album.images);
        gNowPlaying.duration = track.duration_ms;
      }
    }

    // always update play meter info
    gNowPlaying.progress = data.progress_ms;
    gNowPlaying.isPlaying = data.is_playing;
    gNowPlaying.time = now;  // time of update
    gNowPlaying.isIdle = false;

    if (gNowPlaying.isPlaying)
      gNowPlaying.lastPlayingTime = now;  // last time we saw something playing

    debug(gNowPlaying);

    if (id == oldId) {
      updatePlayMeter(gNowPlaying);
    } else {
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

  return {data: gNowPlaying};
}

async function getRecentlyPlayed() {

  var res = await spotifyApi(spotifyRoutes.recentlyPlayed);
  if (res.error)
    return res;

  var data = res.data;
  debug(data);

  var rtrn = {};
  var now = Date.now();

  if (data && data.items) {
    var track = data.items[0].track;
    var album = track.album;
    var artist = getArtistName(track.artists);
    var albumImage = getAlbumImage(album.images);
    var date = getYearFromDate(album.release_date, album.release_date_precision);

    rtrn.type = track.type;  // e.g. 'track'
    rtrn.id = track.uri;     // track ID
    rtrn.track = track.name;
    rtrn.album = album.name;
    rtrn.artist = artist;
    rtrn.date = date;
    rtrn.explicit = track.explicit;
    rtrn.popularity = track.popularity;
    rtrn.albumImage = albumImage;
    rtrn.duration = track.duration_ms;
    rtrn.time = Date.now();
    rtrn.time = now;  // time of update
    debug(rtrn);
  }

  return {data: rtrn};
}

// tbd: seems to be getting artists that come up in 'radio'
async function getTopArtists(count = 10, range = 'medium_term') {
  var res = await spotifyApi(spotifyRoutes.topArtists, count, range);
  if (res.error)
    return res;

  var list = [];
  var data = res.data;

  if (data && data.items) {
    var items = data.items;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      var entry = {};
      entry.albumImage = getAlbumImage(item.images, false);
      entry.name = item.name;
      entry.genre = getGenre(item.genres);
      entry.followers = item.followers.total;
      entry.popularity = item.popularity;

      list.push(entry);
    }
  }

  return {data: list};
}

// this seems to be only getting tracks that you explicitly played
// either directly or by explicitly playing an album
// does not seem to include anything played through a 'radio', so sort or useless
async function getTopTracks(count = 10, range = 'medium_term') {
  var res = await spotifyApi(spotifyRoutes.topTracks, count, range);
  if (res.error)
    return res;

  var list = [];
  var data = res.data;

  if (data && data.items) {
    var items = data.items;
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

  return {data: list};
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

      return {data: await res.json()};
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


async function getLocal(route)
{
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

async function updateAmp()
{
  if (Config.lyngdorfServer==''){
    // return as if all is well
    ampStatus.power='ON';
    ampStatus.streamType='2';
    return;
  }
  try {
    var baseUri = Config.lyngdorfServer;
    var res = await fetch(baseUri + '/status');
    if ( res.status == 200 ) {
      res = await res.json();
      if (res.error)
        return res;
      ampStatus=res;
      return res;
    }

    return {error: `lyngdorf server returned error: ${res.status}`};
  } catch(e) {
    return {error: `lyngdorf server problem: ${e.message}`};
  }
}

function setState(requestedState, data)
{
	if (gState==requestedState)
	  return;
	debug('Changing state to '+requestedState);  
	gPrevState=gState;
	gState=requestedState;
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
