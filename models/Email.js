const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: [String], required: true }, // Array of recipients
  subject: { type: String, required: true },
  body: { type: String, required: true },
  folder: { type: String, enum: ['Inbox', 'Sent', 'Drafts', 'Trash'], default: 'Inbox' },
  sentAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Email', emailSchema);
