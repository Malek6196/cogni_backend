#!/usr/bin/env node
/*
  seed-large-demo.js
  Bulk seeder for CogniCare backend.
  Usage:
    MONGODB_URI="mongodb://localhost:27017/cognicare_dev" node scripts/seed-large-demo.js
    or
    npm run seed:large

  Configurable constants below. This script performs bulk inserts/updates
  and is idempotent by email/title keys.
*/

const mongoose = require('mongoose');
require('dotenv').config();

const DEFAULT_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cognicare_dev';
const DEMO_PASSWORD_HASH = process.env.DEMO_PASSWORD_HASH || '$2a$12$Qz91w8MQ5GtlKiIh7cVaLugkBjMnT9gA4xC5sRGMO8vArIr56h4sy'; // admin123

// CONFIG
const NUM_FAMILIES = Number(process.env.SEED_NUM_FAMILIES) || 200; // families
const CHILDREN_PER_FAMILY = Number(process.env.SEED_CHILDREN_PER_FAMILY) || 3; // children per family
const NUM_SPECIALISTS = Number(process.env.SEED_NUM_SPECIALISTS) || 60; // specialists
const PLANS_PER_CHILD = Number(process.env.SEED_PLANS_PER_CHILD) || 4; // plans per child
const MARKET_ITEMS = Number(process.env.SEED_MARKET_ITEMS) || 500; // marketplace items
const CLOUDINARY_FETCH = process.env.CLOUDINARY_FETCH || null; // e.g. https://res.cloudinary.com/your_cloud/image/fetch/

// Utilities
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => new Date();
const slugifyEmail = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '.');

async function connect() {
  await mongoose.connect(DEFAULT_URI, { maxPoolSize: 20 });
  console.log('Connected to', DEFAULT_URI);
}

function cloudImg(url) {
  if (CLOUDINARY_FETCH) return CLOUDINARY_FETCH + encodeURIComponent(url);
  return url;
}

async function run() {
  await connect();
  const db = mongoose.connection.db;

  // organization
  // Ensure organization exists (some drivers may not return value from findOneAndUpdate reliably)
  let orgDoc = await db.collection('organizations').findOne({ name: 'CogniCare Demo Center' });
  if (!orgDoc) {
    const insertRes = await db.collection('organizations').insertOne({ name: 'CogniCare Demo Center', createdAt: now(), country: 'Tunisia' });
    orgDoc = await db.collection('organizations').findOne({ _id: insertRes.insertedId });
  } else {
    await db.collection('organizations').updateOne({ _id: orgDoc._id }, { $set: { createdAt: now(), country: 'Tunisia' } });
    orgDoc = await db.collection('organizations').findOne({ _id: orgDoc._id });
  }
  const orgId = orgDoc._id;
  console.log('Org id:', orgId.toString());

  // leader
  await db.collection('users').updateOne(
    { email: 'leader@demo.cognicare.local' },
    { $set: { fullName: 'Demo Leader', email: 'leader@demo.cognicare.local', passwordHash: DEMO_PASSWORD_HASH, role: 'organization_leader', organizationId: orgId, isConfirmed: true, profilePic: cloudImg('https://i.pravatar.cc/150?img=10'), createdAt: now() } },
    { upsert: true }
  );

  // generate specialists
  const specRoles = ['psychologist', 'speech_therapist', 'occupational_therapist', 'doctor', 'volunteer'];
  const specialistBulk = [];
  for (let i = 0; i < NUM_SPECIALISTS; i++) {
    const name = `Spec ${i + 1}`;
    const email = `${slugifyEmail(name)}.${i}@demo.cognicare.local`;
    const pic = cloudImg(`https://i.pravatar.cc/150?u=${email}`);
    specialistBulk.push({
      updateOne: {
        filter: { email },
        update: { $set: { fullName: name, email, passwordHash: DEMO_PASSWORD_HASH, role: specRoles[i % specRoles.length], organizationId: orgId, isConfirmed: true, profilePic: pic, createdAt: now() } },
        upsert: true,
      },
    });
  }
  if (specialistBulk.length) await db.collection('users').bulkWrite(specialistBulk, { ordered: false });
  console.log('Specialists upserted:', NUM_SPECIALISTS);

  // generate families and children in batches
  const familyBulk = [];
  const childBulk = [];
  const planBulk = [];
  const firstNames = ['Amine', 'Salma', 'Karim', 'Leila', 'Fatima', 'Ahmed', 'Aisha', 'Hassan', 'Nadia', 'Mahmoud', 'Zeyneb', 'Salim', 'Yasmine', 'Milo', 'Nour', 'Adam', 'Lina', 'Sami', 'Zainab', 'Omar'];
  const lastNames = ['Ben Youssef', 'Trabelsi', 'Bennour', 'Habib', 'Khaled', 'Bouajila', 'Maamri', 'Slama', 'Ben Ali', 'Frikha', 'Souissi'];

  // fetch specialist ids for assignment
  const specialists = await db.collection('users').find({ organizationId: orgId, role: { $in: specRoles } }).project({ _id: 1 }).toArray();
  const specialistIds = specialists.map(s => s._id);

  for (let f = 0; f < NUM_FAMILIES; f++) {
    const parent = `${firstNames[f % firstNames.length]} ${lastNames[f % lastNames.length]}`;
    const email = `family.${f}@demo.cognicare.local`;
    familyBulk.push({ updateOne: { filter: { email }, update: { $set: { fullName: parent, email, passwordHash: DEMO_PASSWORD_HASH, role: 'family', organizationId: orgId, isConfirmed: true, profilePic: cloudImg(`https://i.pravatar.cc/150?u=${email}`), createdAt: now() } }, upsert: true } });

    // children for this family
    for (let c = 0; c < CHILDREN_PER_FAMILY; c++) {
      const childName = `${firstNames[(f + c) % firstNames.length]}_${f}_${c}`;
      const childId = new mongoose.Types.ObjectId();
      const childPic = cloudImg(`https://picsum.photos/seed/${childName}/200/200`);
      const assignedSpec = specialistIds[Math.floor(Math.random() * specialistIds.length)] || null;
      childBulk.push({ updateOne: { filter: { _id: childId }, update: { $set: { _id: childId, name: childName, age: 3 + Math.floor(Math.random() * 9), diagnosis: 'Autism Spectrum Disorder', familyEmail: email, familyId: null, specialistId: assignedSpec, organizationId: orgId, profilePicture: childPic, medicalHistory: 'Auto-seeded history', createdAt: now() } }, upsert: true } });

      // plans for child
      const planTypes = ['PECS', 'TEACCH', 'SkillTracker', 'Activity'];
      for (let p = 0; p < PLANS_PER_CHILD; p++) {
        const type = planTypes[p % planTypes.length];
        planBulk.push({ updateOne: { filter: { childId: childId, planType: type, title: `${type} Plan for ${childName}` }, update: { $set: { childId: childId, organizationId: orgId, specialistId: assignedSpec, planType: type, title: `${type} Plan for ${childName}`, description: `${type} plan`, status: 'active', startDate: new Date(Date.now() - (10 + Math.floor(Math.random() * 60)) * 24 * 60 * 60 * 1000), goals: [`${type} Goal 1`, `${type} Goal 2`], sessions: 5 + Math.floor(Math.random() * 20), progress: Math.floor(Math.random() * 100), notes: `Auto-generated ${type} plan`, createdAt: now() } }, upsert: true } });
      }
    }
  }

  // execute family and child bulks in chunks
  const chunk = (arr, size = 500) => { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; };

  for (const chunkOps of chunk(familyBulk, 500)) {
    await db.collection('users').bulkWrite(chunkOps, { ordered: false });
  }
  console.log('Families upserted:', NUM_FAMILIES);

  for (const chunkOps of chunk(childBulk, 500)) {
    await db.collection('children').bulkWrite(chunkOps, { ordered: false });
  }
  console.log('Children upserted:', NUM_FAMILIES * CHILDREN_PER_FAMILY);

  for (const chunkOps of chunk(planBulk, 500)) {
    await db.collection('specializedplans').bulkWrite(chunkOps, { ordered: false });
  }
  console.log('Plans upserted:', planBulk.length);

  // marketplace
  const marketBulk = [];
  for (let m = 0; m < MARKET_ITEMS; m++) {
    const title = `Demo Product ${m + 1}`;
    const img = cloudImg(`https://picsum.photos/seed/product-${m + 1}/600/400`);
    marketBulk.push({ updateOne: { filter: { title }, update: { $set: { title, description: `Demo product ${m + 1}`, price: 5 + Math.floor(Math.random() * 200), organizationId: orgId, images: [img], stock: 1 + Math.floor(Math.random() * 50), createdAt: now() } }, upsert: true } });
  }
  for (const chunkOps of chunk(marketBulk, 500)) {
    await db.collection('marketplace_products').bulkWrite(chunkOps, { ordered: false });
  }
  console.log('Market items upserted:', MARKET_ITEMS);

  // final: update children familyId and organization refs
  // set familyId by matching family email
  const families = await db.collection('users').find({ organizationId: orgId, role: 'family' }).project({ email: 1 }).toArray();
  const familyEmails = families.map(f => f.email);
  // set familyId for children by mapping familyEmail -> _id
  const familyDocs = await db.collection('users').find({ email: { $in: familyEmails } }).project({ _id: 1, email: 1 }).toArray();
  const famMap = {}; familyDocs.forEach(f => famMap[f.email] = f._id);
  // update children
  const cursor = db.collection('children').find({ organizationId: orgId });
  while (await cursor.hasNext()) {
    const c = await cursor.next();
    const famId = famMap[c.familyEmail] || null;
    await db.collection('children').updateOne({ _id: c._id }, { $set: { familyId: famId } });
  }

  // update organization references
  const staffIds = await db.collection('users').find({ organizationId: orgId, role: { $nin: ['family'] } }).project({ _id: 1 }).toArray();
  const childIds = await db.collection('children').find({ organizationId: orgId }).project({ _id: 1 }).toArray();
  const famIds = await db.collection('users').find({ organizationId: orgId, role: 'family' }).project({ _id: 1 }).toArray();
  await db.collection('organizations').updateOne({ _id: orgId }, { $set: { staffIds: staffIds.map(s => s._id), childrenIds: childIds.map(c => c._id), familyIds: famIds.map(f => f._id), leaderId: (await db.collection('users').findOne({ email: 'leader@demo.cognicare.local' }))._id } });

  // print counts
  const ucount = await db.collection('users').countDocuments({ organizationId: orgId });
  const ccount = await db.collection('children').countDocuments({ organizationId: orgId });
  const pcount = await db.collection('specializedplans').countDocuments({ organizationId: orgId });
  const mcount = await db.collection('marketplace_products').countDocuments({ organizationId: orgId });
  console.log(`Seed summary: users=${ucount}, children=${ccount}, plans=${pcount}, market=${mcount}`);

  await mongoose.disconnect();
  console.log('Disconnected, done.');
}

run().catch(err => { console.error('Seed error:', err); process.exit(1); });
