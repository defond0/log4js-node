"use strict"
var amqp =require('amqplib');
var layouts = require('../layouts');
var levels = require('../levels');

var LOG_EMERG=0;    // system is unusable
var LOG_ALERT=1;    // action must be taken immediately
var LOG_CRIT=2;     // critical conditions
var LOG_ERR=3;      // error conditions
var LOG_ERROR=3;    // because people WILL typo
var LOG_WARNING=4;  // warning conditions
var LOG_NOTICE=5;   // normal, but significant, condition
var LOG_INFO=6;     // informational message
var LOG_DEBUG=7;    // debug-level message

var levelMapping = {};
levelMapping[levels.ALL] = LOG_DEBUG;
levelMapping[levels.TRACE] = LOG_DEBUG;
levelMapping[levels.DEBUG] = LOG_DEBUG;
levelMapping[levels.INFO] = LOG_INFO;
levelMapping[levels.WARN] = LOG_WARNING;
levelMapping[levels.ERROR] = LOG_ERR;
levelMapping[levels.FATAL] = LOG_CRIT;

/*
So here is a gelf formatting amqp appender for log4js 
*/

function gelfAmqpAppender(layout, url, facility, config){
    var _channelPromise, _connectionPromise;
    var _config = config;
    
    _connectionPromise = amqp.connect(url)

    process.on('exit', function() {
        if (_connectionPromise) {_connectionPromise.then(function(conn){conn.close()})};
    });

    var _defaultCustomFields = _config.customFields || {};

    if(facility){
        _defaultCustomFields['_facility'] = facility;
    }

    
    function prepareMessage(loggingEvent){
        var msg = {};
        addCustomFields(loggingEvent, msg);
        msg.short_message = layout(loggingEvent);
        msg.version="1.1";
        msg.timestamp = msg.timestamp || new Date().getTime() / 1000; // log should use millisecond 
        msg.host = _config.hostname;
        msg.level = levelMapping[loggingEvent.level || levels.DEBUG];
        return msg;
    }

    function sendMessage(loggingEvent){
        var msg = prepareMessage(loggingEvent);
        key = ''||_config.routingKey;
        _connectionPromise.then(function(conn){
            _channelPromise = conn.createChannel().then(function(ch){
                ch.assertExchange(_config.exchange.name, _config.exchange.type, {durable : _config.exchange.durable,
                                                                                autoDelete : _config.exchange.autoDelete});
                ch.publish(_config.exchange.name, key, new Buffer(JSON.stringify(msg)));  
            }); 
        }); 
        
    }

    return function(loggingEvent){
        //gelf up loggingEvent and send to rabbit
        try{
            if(_connectionPromise._handler.resolved){
                sendMessage(loggingEvent);
            }
            else{
                Promise.resolve(_connectionPromise).then(sendMessage(loggingEvent))
            }
        }catch(e){
            console.log(e.stack);
        }
    };

    /**
    *This is borrowed from gelf.js 
    *Add custom fields (start with underscore ) 
    * - if the first object passed to the logger contains 'GELF' field, 
    *   copy the underscore fields to the message
    * @param loggingEvent
    * @param msg
    */
    function addCustomFields(loggingEvent, msg){
    /* append _defaultCustomFields firsts */
        Object.keys(_defaultCustomFields).forEach(function(key) {
        // skip _id field for graylog2, skip keys not starts with UNDERSCORE
            if (key.match(/^_/) && key !== "_id") { 
                msg[key] = _defaultCustomFields[key];
            }
        });

        /* append custom fields per message */
        var data = loggingEvent.data;
        if (!Array.isArray(data) || data.length === 0) return;
        var firstData = data[0];

        if (!firstData.GELF) return; // identify with GELF field defined
        // Remove the GELF key, some gelf supported logging systems drop the message with it
        delete firstData.GELF;

        Object.keys(firstData).forEach(function(key) {
          // skip _id field for graylog2, skip keys not starts with UNDERSCORE
          if (key.match(/^_/) || key !== "_id") { 
            msg[key] = firstData[key];
          }
        });

        /* the custom field object should be removed, so it will not be looged by the later appenders */
        loggingEvent.data.shift(); 
    }
};
/*
 config = {
    url:'amqp://localhost:5672',
    hostname:require("os").hostname(),
    routingKey: 'key',  //could be null or ''
    facility: 'DeFond\'s Rabbit Adventure', // facility name 
    exchange:{  // built to focus on exchanges
        durable:true,
        autoDelete:false,
        name: 'gelf_log_exchange',
        type: 'direct'
    },
    layout: {
       type: 'pattern',
       pattern: "[%r] [%[%5.5p%]] - %m%n"
   }
*/
function configure(config){
  var layout;
  if (config.layout) {
    layout = layouts.layout(config.layout.type, config.layout);
  }
  return gelfAmqpAppender(layout, config.url, config.facility, config);
};

exports.appender = gelfAmqpAppender;
exports.configure = configure;