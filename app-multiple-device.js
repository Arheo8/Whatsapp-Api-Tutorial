const { Client, MessageMedia } = require('whatsapp-web.js');
const cron = require('node-cron');
const express = require('express');
const { body, validationResult } = require('express-validator');
const expressLayouts = require('express-ejs-layouts');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const port = process.env.PORT || 8000;
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const flash = require('connect-flash');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const path = require('path');
dotenv.config({ path: path.resolve(__dirname, './.env') });
require('./config/passport')(passport);

// DB Config
const db = "mongodb+srv://Arheo_pj:QCbuRzvzK6Nc2ZZ@cluster0.sgnjk.mongodb.net/myFirstDatabase?retryWrites=true&w=majority";

// Connect to MongoDB
mongoose
  .connect(
    db,
    { useNewUrlParser: true ,useUnifiedTopology: true}
  )
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

app.use(expressLayouts); 
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
app.use(fileUpload({
  debug: true
}));

// Express session
app.use(
  session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
  })
);

// Connect flash
app.use(flash());

// Global variables
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

const { ensureAuthenticated, forwardAuthenticated } = require("./config/auth");

// Welcome Page
app.get("/", forwardAuthenticated, (req, res) => res.render('register'));

app.get('/dashboard', ensureAuthenticated, function(req, res){
  res.render('index-multiple-device',
  {
    user: req.user,
  });
});
app.get('/send-message', ensureAuthenticated, function(req, res){
  
  var path = require('path');
  var filename = path.resolve('./whatsapp-sessions.json');
  delete require.cache[filename];
  var data = require('./whatsapp-sessions.json');
  console.log(data);
  res.render('index-send', {data:data, user: req.user,});
});

app.get('/send-media', ensureAuthenticated, function(req, res){
  
  var path = require('path');
  var filename = path.resolve('./whatsapp-sessions.json');
  delete require.cache[filename];
  var data = require('./whatsapp-sessions.json');
  console.log(data);
  res.render('index-send-media', {data:data, user: req.user,});
});

app.use('/users', require('./routes/users.js'));

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id, description, username) {
  console.log('Creating session: ' + id);
  const SESSION_FILE_PATH = `./whatsapp-session-${id}.json`;
  let sessionCfg;
  if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
  }

  const client = new Client({
    qrTimeoutMs: 0,
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    session: sessionCfg
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', (session) => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
    sessionCfg = session;
    fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function(err) {
      if (err) {
        console.error(err);
      }
    });
  });

  client.on('auth_failure', function(session) {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    fs.unlinkSync(SESSION_FILE_PATH, function(err) {
        if(err) return console.log(err);
        console.log('Session file deleted!');
    });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    username: username,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      username: username,
      ready: false,
    });
    setSessionsFile(savedSessions);
    io.emit('add-template');
  }
  else {
    io.emit('already-there');
  }
}

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description, sess.username);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description, data.username);
  });
});

// io.on('connection', function(socket) {
//   socket.emit('message', 'Connecting...');

//   client.on('qr', (qr) => {
//     console.log('QR RECEIVED', qr);
//     qrcode.toDataURL(qr, (err, url) => {
//       socket.emit('qr', url);
//       socket.emit('message', 'QR Code received, scan please!');
//     });
//   });

//   client.on('ready', () => {
//     socket.emit('ready', 'Whatsapp is ready!');
//     socket.emit('message', 'Whatsapp is ready!');
//   });

//   client.on('authenticated', (session) => {
//     socket.emit('authenticated', 'Whatsapp is authenticated!');
//     socket.emit('message', 'Whatsapp is authenticated!');
//     console.log('AUTHENTICATED', session);
//     sessionCfg = session;
//     fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function(err) {
//       if (err) {
//         console.error(err);
//       }
//     });
//   });

//   client.on('auth_failure', function(session) {
//     socket.emit('message', 'Auth failure, restarting...');
//   });

//   client.on('disconnected', (reason) => {
//     socket.emit('message', 'Whatsapp is disconnected!');
//     fs.unlinkSync(SESSION_FILE_PATH, function(err) {
//         if(err) return console.log(err);
//         console.log('Session file deleted!');
//     });
//     client.destroy();
//     client.initialize();
//   });
// });

// Send message


app.post('/send-media',[
  body('number').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;

  // const fileUrl = req.body.file;
  // var fileName = req.body.filename;
  // if(String(fileName) == String("undefined")){
  //   fileName = "Media";
  // }

  const client = sessions.find(sess => sess.id == sender).client;
  // const media = MessageMedia.fromFilePath('./image-example.png');
  const file = req.files.filename;
  const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  // let mimetype;
  // const attachment = await axios.get(fileUrl, {
  //   responseType: 'arraybuffer'
  // }).then(response => {
  //   mimetype = response.headers['content-type'];
  //   return response.data.toString('base64');
  // });

  // const media = new MessageMedia(mimetype, attachment, fileName);
  console.log(media)

  client.isRegisteredUser(String(number)).then(function(isRegistered) {
    if(isRegistered) {
      client.sendMessage(number, media, {
        caption: caption
      }).then(response => {
        res.status(200).json({
          status: true,
          response: response
        });
      }).catch(err => {
        res.status(500).json({
          status: false,
          response: err
        });
      });
    }
    else
    {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }
})  

});



app.post('/send-message',[
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }
  console.log("sendmessage",req.body)
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find(sess => sess.id == sender).client;

  client.isRegisteredUser(String(number)).then(function(isRegistered) {
    if(isRegistered) {
      client.sendMessage(number, message).then(response => {
        res.status(200).json({
          status: true,
          response: response
        });
      }).catch(err => {
        res.status(500);
      });
    }
    else
    {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }
})  
});

server.listen(port, function() {
  console.log('App running on *: ' + port);
});