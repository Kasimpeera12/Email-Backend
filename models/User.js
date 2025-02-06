const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email_id: { type: String, required: true, unique: true },  // Changed from 'email' to 'email_id'
  app_password: { type: String, required: true }  // Changed from 'emailPassword' to 'app_password'
});

module.exports = mongoose.model('User', UserSchema);
