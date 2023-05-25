const WebSocketServer = require('websocket').server;
const http = require('http');
const server = http.createServer();
const { error } = require('console');

// Start the server
const port = 8000; // You can change this to your preferred port
server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
})

const wsServer = new WebSocketServer({ 
    httpServer : server 
});

const clientsDictionary = {};
var amqp = require('amqplib/callback_api');
var url = 'amqp://admin:1v1s1nd1a@10.0.1.14:5672';  // "amqp://localhost"
var rabbitmqConn = null;
var queueName = "Default_Manual_Wall";
var prefetchCount = 1;

const ProcessMessage = (msg, clientID) => {
    var eventobj = {};
    if(msg != null)
    {
        //console.log("Consumed msg :", msg)
        var msg_convertedIntoString = msg.content.toString();
        var eventobj = {};
        eventobj.deliveryTag = msg.fields.deliveryTag;
        eventobj.event = JSON.parse(msg_convertedIntoString);
        clientsDictionary[clientID].messageDict.set(msg.fields.deliveryTag, msg);
        console.log("consumed message deliveryTag : ", msg.fields.deliveryTag);
        
        return eventobj;
    }
}

const ConnectToRabbitMQ = (clientID) => {
    console.log("ConnectToRabbitMQ is hitted...and used clientID : ", clientID);
    //console.log("clientsDictionary[clientID] : ", clientsDictionary[clientID]);
    if(clientsDictionary[clientID].rabbitmqConnection === null && clientsDictionary[clientID].rabbitmqChannel === null)
    {
        console.log("Initializing new connection...!");
        amqp.connect(url, function(error0, _connection){
            if(error0)
                console.log(error0); ////reject(error0);
            if(_connection !== null)
            {
                if(clientsDictionary[clientID].rabbitmqConnection === null){
                    clientsDictionary[clientID].rabbitmqConnection = _connection;
                    rabbitmqConn = _connection;
                    //console.log("rabbitmqConnection : " ,rabbitmqConnection);
                }
                clientsDictionary[clientID].rabbitmqConnection.createChannel(function(error1, _channel)
                {
                    if(error1)
                        console.log(error1);   //reject(error1);
                    else
                    {
                        if(_channel !== null)
                        {
                            if(clientsDictionary[clientID].rabbitmqChannel === null){
                                clientsDictionary[clientID].rabbitmqChannel = _channel;
                                console.log("New rabbitmq channel is created...!");
                            }
                        }              
                        else
                        {
                            console.log("Unable to create rabbitmq channel...!");
                        }
                    }
                });
            }
        });
    }
    else
    {
        console.log("Using old rabbitmq channel...!");
    }
}

const getUniqeID = () => {
    const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return s4() + s4() + '_' + s4();
}

var rabbitMQConnections = {};
wsServer.on('request', function (request) {
    // var recievedRequesMessage = JSON.parse(request);
    console.log("Recieved Request key : ", request.key);
    var clientID = getUniqeID();
    console.log((new Date()) + ' Reacieved a new connection from origin ' + request.origin + '.');

    const connection = request.accept(null, request.origin);
    //var rabbitmqConnection = null;
    //var channel = null;
    clientsDictionary[clientID] = {
        "clientID":clientID,
        "connection":connection,
        "rabbitmqConnection":null,
        "rabbitmqChannel":null,
        "messageDict":new Map()
    }; //connection;
    ConnectToRabbitMQ(clientID);
    const connectionArray = Object.getOwnPropertyNames(clientsDictionary);
    console.log('Connected: ' + clientID + ' in ' + connectionArray);
    clientsDictionary[clientID].connection.send(JSON.stringify({"type": "clientconnected","message": "assignedclientID :" + clientsDictionary[clientID].clientID}));


    // on message occurred
    clientsDictionary[clientID].connection.on('message' , function(message){
        
        var recievedMessage = JSON.parse(message.utf8Data);
        console.log('Recieved Message : ', recievedMessage , ' from clientID : ', clientID);
        if(recievedMessage.type === 'sendmsgtoserver'){
            console.log("clientId : ", clientID);
            // console.log("current connection : ", clientsDictionary[clientID].connection);
            if(recievedMessage.msg === 'appclosing'){
                clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":clientID+' is closed'}));
                clientsDictionary[clientID] = null;
                clientsDictionary[clientID].connection.close();
            }
            else
                clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":clientID}));
        }
        if(recievedMessage.type === 'rabbitmqconnection'){
            // Connect to RabbitMQ...
            ConnectToRabbitMQ(clientID);
        }
        if(recievedMessage.type === 'checkrabbitmqconnection'){
            if(!clientsDictionary[clientID].rabbitmqChannel || !clientsDictionary[clientID].rabbitmqConnection){
                clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":"false"}));
            }
            else
            {
                clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":"true"}));
            }
        }
        if(recievedMessage.type === 'reconnectrabbitmq'){
            try {
                this.ConnectToRabbitMQ(clientID);
                clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":"Reconnected to RabbitMQ."}));
            } catch (error) 
            {
                clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":error}));
            }
            
        }
        if(recievedMessage.type === 'startconsuming'){
            //console.log('start consuming --> recievedMessage.type : ',recievedMessage.type,'recievedMessage.value',recievedMessage.msg);
            
            if(clientsDictionary[clientID].rabbitmqConnection !== null && clientsDictionary[clientID].rabbitmqChannel !== null)
            { 
                try {
                    prefetchCount = recievedMessage.msg;
                    clientsDictionary[clientID].rabbitmqChannel.prefetch(prefetchCount, false); 
                    clientsDictionary[clientID].rabbitmqChannel.consume( queueName, (msg) =>
                    {
                        if(msg != null)
                        {
                            var consumedMsg = ProcessMessage(msg,clientID);
                            //return consumedMsg;
                            //console.log("consumedMsg : ", consumedMsg);
                            clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":consumedMsg}));
                        }
                    }, { noAck: false, persistent: true });
                } catch (error) {
                    console.log("got error : ", error);
                    clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":error}));
                }                       
            }
            else
            {
                console.log("Not connected....retry is hitted...!")
                ConnectToRabbitMQ(clientID);
                clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":"RabiitMQ not connected. Please Try again."}));
            }
        }
        if(recievedMessage.type === 'ackmessage'){
            
            if(clientsDictionary[clientID].rabbitmqConnection !== null && clientsDictionary[clientID].rabbitmqChannel !== null)
            {
                try {
                    var deliveryTag = recievedMessage.msg ;
                    if(clientsDictionary[clientID].messageDict.has(deliveryTag)){
                        var msgToAck = clientsDictionary[clientID].messageDict.get(deliveryTag);
                        console.log("deliveryTeg of message to ack : ", deliveryTag)
                        clientsDictionary[clientID].rabbitmqChannel.ack(msgToAck, false);
                        messageDict.delete(deliveryTag)
                        clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":"Message is acknowledged on the server side."}));
                        console.log("Event is acknowledged...!")
                    }
                    else
                    {
                        console.log("messageDict does not have clientID(deliveryTag) :", deliveryTag);
                        clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":"Message is already acknowledged."}));
                    }
                } 
                catch (error) {
                    clientsDictionary[clientID].connection.send(JSON.stringify({"type": recievedMessage.type,"message":error}));
                }
            }
            else{
                clientsDictionary[clientID].connection.send( JSON.stringify({"type": recievedMessage.type,"message":"Message is not acknowledged on the server side.."}));
            }
        }
    });

    clientsDictionary[clientID].connection.on('error', function(){
        clientsDictionary[clientID].connection.send(JSON.stringify({"type": "Error","message":error}));
    });

    clientsDictionary[clientID].connection.on('close', function(){
        if(clientsDictionary[clientID] !== null){
            console.log("connection closing started for clientID : ", clientID);
            if(clientsDictionary[clientID].rabbitmqConnection !== null){
                if(clientsDictionary[clientID].rabbitmqChannel !== null){
                    console.log("closing rabbitmq channel...");
                    clientsDictionary[clientID].rabbitmqChannel.close();
                }
                console.log("closing rabbitmq connection...");
                clientsDictionary[clientID].rabbitmqConnection.close();
            }
            console.log("deleting the client/user from clientsDictionary...");
            delete clientsDictionary[clientID];
        }
        console.log("connection closed for clientID : ", clientID);
    });
});


//--------------------------------------------------------------------------------------------------------








// // Event handler for new socket connections
// io.on('connection', (socket) => {
//     console.log('A new user connected');
  
//     // Event handler for chat messages
//     socket.on('chat message', (message) => {
//       console.log('Received message:', message);
//       // Broadcast the message to all connected clients
//       io.emit('chat message', message);
//     });
  
//     // Event handler for socket disconnection
//     socket.on('disconnect', () => {
//       console.log('A user disconnected');
//     });
  
//     // Send data every second
//     setInterval(() => {
//       const data = { message: 'Hello, client!' };
//       socket.emit('data', data);
//     }, 1000);
  
//   });