/* ***********************************************
 * lyngdorf_server
 * by drdude684
*/
 
// DO NOT EDIT this file. Copy it to 'myconfig.js' and adjust to your preference
exports.debug = true;                      // show debugging msgs
exports.ip = "127.0.0.1";                  // IP address to listen on, defaults to host name
exports.port = 8008;                       // port to listen on, defaults to 80
exports.lyngdorfaddress = 'tdai1120.local' // IP address of lyngdorf device
exports.powerScreenByAmp = true;           // switches screen on and off along with amp power status
exports.demoIfError = true;                // fallback to demo mode if something is wrong
exports.demoMode = false;                  // force demo mode
exports.demoCycleTime = 20;                // how many seconds to spend in each demo view
exports.refreshInterval = 500;             // if non-zero, how many ms between polling amp for status
