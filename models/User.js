const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true
  },
  number: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  number_of_scanned_users: {
    type: Number,
    required: true,
    default: 0
  }
});

const User = mongoose.model('User', UserSchema);

module.exports = User;