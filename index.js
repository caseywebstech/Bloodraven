 

const express = require('express');
const app = express();
__path = process.cwd()
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
let code = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 1000;

// Fixed: Added app.use for bodyParser before routes that need it
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/code', code);
app.use('/pair', async (req, res, next) => {
    res.sendFile(__path + '/pair.html');
});
app.use('/', async (req, res, next) => {
    res.sendFile(__path + '/main.html');
});

// ✅ Changed here to bind on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
    console.log(` 
/*

 _____                                 _                 _            
/  __ \\                               | |               | |           
| /  \\/  __ _  ___   ___  _   _  _ __ | |__    ___    __| |  ___  ___ 
| |     / _\` |/ __| / _ \\| | | || '__|| '_ \\  / _ \\  / _\` | / _ \\/ __|
| \\__/\\| (_| |\\__ \\|  __/| |_| || |   | | | || (_) || (_| ||  __/\\__ \\
 \\____/ \\__,_||___/ \\___| \\__, ||_|   |_| |_| \\___/  \\__,_| \\___||___/
                           __/ |                                      
                          |___/                                       

 _____              _     
|_   _|            | |    
  | |    ___   ___ | |__  
  | |   / _ \\ / __|| '_ \\ 
  | |  |  __/| (__ | | | |
  \\_/   \\___| \\___||_| |_|
@ Project Name : caseyrhodes tech 
* Creator      : Caseyrhodes Tech 
* My Git       : https//github.com/caseyweb 
* Contact      : wa.me/254112192119
*
* Release Date : 18 august 2025 12.01 AM
*/

Server running on http://0.0.0.0:` + PORT);
});

module.exports = app;
