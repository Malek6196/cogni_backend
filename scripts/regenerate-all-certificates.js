#!/usr/bin/env node
/**
 * Script to force regeneration of ALL volunteer certificates
 * Usage: node scripts/regenerate-all-certificates.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const volunteerApplicationSchema = new mongoose.Schema({}, { collection: 'volunteerapplications', strict: false });
const VolunteerApplication = mongoose.model('VolunteerApplication', volunteerApplicationSchema);

async function regenerateAllCertificates() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🔍 Finding all certified volunteers...');
    const apps = await VolunteerApplication.find({ 
      trainingCertified: true,
      certificationCertificateUrl: { $exists: true, $ne: null }
    });

    if (apps.length === 0) {
      console.log('ℹ️  No certificates found to regenerate');
      process.exit(0);
    }

    console.log(`📋 Found ${apps.length} certificate(s) to regenerate\n`);

    for (const app of apps) {
      console.log(`🔄 Processing certificate ${app.certificationCertificateId}`);
      console.log(`   User ID: ${app.userId}`);
      
      app.certificationCertificateUrl = undefined;
      app.certificationCertificateId = undefined;
      app.certificationIssuedAt = undefined;
      
      await app.save();
      console.log(`   ✅ Removed cached certificate data\n`);
    }

    console.log('🎉 All done! Next time users open their certificates,');
    console.log('   they will be regenerated with the new template!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

regenerateAllCertificates();
