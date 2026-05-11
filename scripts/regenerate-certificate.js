#!/usr/bin/env node
/**
 * Script to force regeneration of a volunteer's certificate
 * Usage: node scripts/regenerate-certificate.js <userId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

const volunteerApplicationSchema = new mongoose.Schema({}, { collection: 'volunteerapplications', strict: false });
const VolunteerApplication = mongoose.model('VolunteerApplication', volunteerApplicationSchema);

async function regenerateCertificate(userId) {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log(`🔍 Looking for user: ${userId}`);
    const app = await VolunteerApplication.findOne({ 
      userId: new mongoose.Types.ObjectId(userId) 
    });

    if (!app) {
      console.error('❌ No application found for this user');
      process.exit(1);
    }

    console.log(`📋 Found application for user`);
    console.log(`   - Current certificate ID: ${app.certificationCertificateId || 'None'}`);
    console.log(`   - Current certificate URL: ${app.certificationCertificateUrl ? 'Yes' : 'No'}\n`);

    if (!app.trainingCertified) {
      console.error('❌ User is not certified yet (trainingCertified is false)');
      process.exit(1);
    }

    console.log('🗑️  Removing cached certificate data...');
    app.certificationCertificateUrl = undefined;
    app.certificationCertificateId = undefined;
    app.certificationIssuedAt = undefined;
    
    await app.save();
    
    console.log('✅ Certificate data removed!');
    console.log('\n🎉 Next time the user opens their certificate in the app,');
    console.log('   it will be regenerated with the new template!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Get userId from command line
const userId = process.argv[2];

if (!userId) {
  console.error('❌ Usage: node scripts/regenerate-certificate.js <userId>');
  console.error('   Example: node scripts/regenerate-certificate.js 507f1f77bcf86cd799439011');
  process.exit(1);
}

regenerateCertificate(userId);
