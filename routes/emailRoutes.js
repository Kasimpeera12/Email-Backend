const express = require('express');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const Imap = require('imap');
const User = require('../models/User');
const Email = require('../models/Email');

const router = express.Router();

// Helper function to fetch emails from a specific folder
const fetchEmailsFromFolder = (imapConfig, folder) => {
  return new Promise((resolve, reject) => {
    const imap = new Imap(imapConfig);
    const emails = [];

    imap.once('ready', () => {
      imap.openBox(folder, true, (err) => {
        if (err) {
          console.error(`Error opening ${folder}:`, err.message);
          return reject(new Error(`Failed to open ${folder}: ` + err.message));
        }

        imap.search(['ALL'], (err, results) => {
          if (err) {
            console.error(`Error searching ${folder}:`, err.message);
            return reject(new Error(`Failed to search ${folder}: ` + err.message));
          }

          if (!results || results.length === 0) {
            console.log(`No emails found in ${folder}`);
            return resolve([]);
          }

          const fetch = imap.fetch(results, { bodies: '', struct: true });

          fetch.on('message', (msg, seqno) => {
            let emailData = '';

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                emailData += chunk.toString();
              });
            });

            msg.once('end', () => {
              simpleParser(emailData, (err, parsed) => {
                if (err) {
                  console.error(`Error parsing email in ${folder}:`, err.message);
                } else {
                  emails.push({
                    id: seqno,
                    subject: parsed.subject || '(No Subject)',
                    from: parsed.from?.text || '(Unknown Sender)',
                    to: parsed.to?.text || '(Unknown Recipient)',
                    body: parsed.text || parsed.html || '(No Content)',
                    date: parsed.date || new Date(),
                    folder,
                  });
                }
              });
            });
          });

          fetch.once('error', (err) => {
            console.error(`Error fetching messages in ${folder}:`, err.message);
            reject(new Error(`Failed to fetch emails in ${folder}: ` + err.message));
          });

          fetch.once('end', () => {
            console.log(`Finished fetching all emails from ${folder}`);
            resolve(emails);
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error(`IMAP error in ${folder}:`, err.message);
      reject(new Error(`IMAP connection failed in ${folder}: ` + err.message));
    });

    imap.connect();
  });
};

router.post("/register", async (req, res) => {
  try {
    const { username, phoneNumber, email_id, app_password } = req.body;

    if (!username || !phoneNumber || !email_id || !app_password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email_id });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // 🔹 Hash the app_password before saving to the database
    const hashedPassword = await bcrypt.hash(app_password, 10);

    const newUser = new User({ username, phoneNumber, email_id, app_password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Server error" });
  }
});
//login
router.post("/login", async (req, res) => {
  try {
    const { email_id, app_password } = req.body;

    // Find user by email
    const user = await User.findOne({ email_id });
    if (!user) {
      return res.status(401).json({ error: "Invalid email_id or app_password" });
    }

    // Compare hashed password
    const isMatch = await bcrypt.compare(app_password, user.app_password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email_id or app_password" });
    }

    res.json({ message: "Login successful" });
  } catch (err) {
    res.status(500).json({ error: "Authentication failed", details: err.message });
  }
});


// Fetch Emails from IMAP Folders
const fetchEmails = async (req, res, folder) => {
  const { email, emailPassword } = req.query;
  try {
    const user = await User.findOne({ email_id: email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const isPasswordValid = await bcrypt.compare(emailPassword, user.app_password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email password' });
    }
    const imapConfig = {
      user: email,
      password: emailPassword,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    };
    const emails = await fetchEmailsFromFolder(imapConfig, folder);
    res.json(emails);
  } catch (err) {
    console.error(`Error fetching emails from ${folder}:`, err.message);
    res.status(500).json({ error: `Failed to fetch emails from ${folder}`, details: err.message });
  }
};

router.get('/inbox', async (req, res) => fetchEmails(req, res, 'INBOX'));
router.get('/sent', async (req, res) => fetchEmails(req, res, '[Gmail]/Sent Mail'));
router.get('/trash', async (req, res) => fetchEmails(req, res, '[Gmail]/Trash'));
router.get('/drafts', async (req, res) => fetchEmails(req, res, '[Gmail]/Drafts'));

router.post('/send-email', async (req, res) => {
  const { from, to, subject, body, emailPassword } = req.body;

  try {
    // Log the sender email for debugging
    console.log('Sender email:', from);

    // Check if the sender email exists in the database
    const sender = await User.findOne({ email_id: from });
    if (!sender) {
      return res.status(404).json({ error: 'Sender email not found' });
    }

    // Verify the email password
    const isPasswordValid = await bcrypt.compare(emailPassword, sender.app_password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email password' });
    }

    // Set up the Nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: from,
        pass: emailPassword,
      },
    });

    // Prepare the email details
    const mailOptions = {
      from,
      to: to.join(','),  // Convert to array of emails if needed
      subject,
      text: body,
    };

    // Send the email using Nodemailer
    await transporter.sendMail(mailOptions);

    // Save the sent email to the database
    const sentEmail = new Email({
      from,
      to,
      subject,
      body,
      folder: 'Sent',
    });
    await sentEmail.save();

    // Save a copy of the email in the recipient's inbox
    const inboxEmails = to.map((recipient) => ({
      from,
      to: [recipient],
      subject,
      body,
      folder: 'Inbox',
    }));
    await Email.insertMany(inboxEmails);

    res.json({ message: 'Email sent successfully' });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: 'Email sending failed', details: err.message });
  }
});

module.exports = router;
