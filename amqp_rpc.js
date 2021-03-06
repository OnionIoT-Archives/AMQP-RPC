'use strict';

var uuid = require('node-uuid');
var amqp = require('amqplib');
var util = require('util');
var config = {};
try{
    config = require('/etc/onionConfig.json').AMQP_RPC;
}catch(err){
    throw "Config file not found. Clone the server-config project form git and follow README";
}

var log = function(msg){
    process.stdout.write("onion::amqp_rpc: ");
    console.log (msg);
}



var mqServerUrl = util.format('amqp://%s:%s@%s:%s/%s', 
        config.MQ_USER,
        config.MQ_PASS,
        config.MQ_DOMAIN,
        config.MQ_PORT,
        config.MQ_VPATH);
var conn = null;
var open = amqp.connect(mqServerUrl);
open.then(function(connection) {
    log('mq connection opened');
    conn = connection;
});

exports.call = function (method, params, callback){


    var replyQueue = null;
    if (typeof callback !== 'undefined') {
        // No return 
        var replyQueue = 'rpc-'+uuid.v4();
    }


    var payload = {
        replyTo: replyQueue,
        params: params
    }

    open.then(function(conn) {
        conn.createChannel().then(function(ch) {
            if (replyQueue !== null){
                // expecting reply
                var timeOutId = setTimeout(function(){
                    ch.close();
                    log('time out');
                },5000);

                var options = {durable: false, noAck: false, autoDelete: true};
                ch.assertQueue(replyQueue, options);
                ch.consume(replyQueue, function(msg) {
                    if (msg !== null) {
                        ch.ack(msg);
                        ch.close();
                        clearTimeout(timeOutId);
                        try{
                        	callback(JSON.parse(msg.content.toString()));
                        }catch(err){
                        	console.log(err.stack);
                        	console.log(err.lineNumber);
                        }
                        
                    }
                });
            }
            ch.sendToQueue(method, new Buffer(JSON.stringify(payload)));
        });
    });
}

var connectionTable = {};

exports.register = function (method, callback){
    open.then(function(conn) {
        return conn.createChannel().then(function(ch) {
            var options = {durable: false, noAck: false, autoDelete: true};
            ch.assertQueue(method, options);
            connectionTable[method] = ch;
            ch.consume(method, function(msg) {
                if (msg !== null) {
                    ch.ack(msg);
                    var data = JSON.parse(msg.content.toString());
                    if (data.replyTo !== null) {
                        callback(data.params, function(result){
                            ch.sendToQueue(data.replyTo, new Buffer(JSON.stringify(result)));
                        });
                    }else{
                        callback(data.params);
                        log ('no return');
                    }
                }
            });
        });
    });
}

exports.unregister = function (method){
    connectionTable[method].close();
    connectionTable[method] = null;
}


/*******  Logging  *******/

var _logModule = "N/A"
exports.setLogModule = function (module) {
    _logModule = module
}

exports.log = function (msg, level){
    if(typeof(level)==='undefined') level = 'DEBUG';
    module = _logModule;
    exports.call('UTIL_LOG',{'module': module, 'level': level,  'msg': msg});
}
