#!/usr/bin/env node
/**
 * Script to list all volunteer applications with certification info
 */

const mongoose = require('mongoose');
require('dotenv').config();

const volunteerApplicationSchema = new mongoose.Schema({}, { collection: 'volunteerapplications', strict: false });
const VolunteerApplication = mongoose.model('VolunteerApplication', volunteerApplicationSchema);

async function listCertificates() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🔍 Finding all volunteer applications...');
    const apps = await VolunteerApplication.find({}).lean();

    console.log(`📋 Found ${apps.length} application(s)\n`);

    for (const app of apps) {
      console.log(`\n📄 Application:`);
      console.log(`   User ID: ${app.userId}`);
      console.log(`   Training Certified: ${app.trainingCertified || false}`);
      console.log(`   Certificate ID: ${app.certificationCertificateId || 'None'}`);
      console.log(`   Certificate URL: ${app.certificationCertificateUrl ? 'Yes' : 'No'}`);
      console.log(`   Issued At: ${app.certificationIssuedAt || app.trainingCertifiedAt || 'None'}`);
      console.log(`   Organization: ${app.organizationName || 'None'}`);
    }

    console.log('\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

listCertificates();
