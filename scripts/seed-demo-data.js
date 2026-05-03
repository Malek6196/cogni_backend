const mongoose = require('mongoose');
require('dotenv').config();

// Pre-generated bcrypt hash for password: admin123
const DEMO_PASSWORD_HASH = '$2a$12$Qz91w8MQ5GtlKiIh7cVaLugkBjMnT9gA4xC5sRGMO8vArIr56h4sy';

// Config - adjust these for demo size
const NUM_FAMILIES = 200;
const CHILDREN_PER_FAMILY = 3;
const NUM_SPECIALISTS = 60;
const PLANS_PER_CHILD = 4;
const NUM_MARKET_ITEMS = 300;

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cognicare_dev';
  try {
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

async function upsertDoc(collection, filter, data) {
  try {
    let doc = await collection.findOne(filter);
    if (doc) {
      await collection.updateOne({ _id: doc._id }, data);
      return await collection.findOne({ _id: doc._id });
    } else {
      const inserted = await collection.insertOne({
        ...filter,
        ...data.$set,
      });
      return await collection.findOne({ _id: inserted.insertedId });
    }
  } catch (error) {
    console.error(`Error upserting document:`, error.message);
    throw error;
  }
}

// Helper: Generate Tunisian names
const firstNames = ['Amine', 'Salma', 'Karim', 'Leila', 'Yasmine', 'Milo', 'Nour', 'Adam', 'Lina', 'Sami', 'Zainab', 'Omar', 'Fatima', 'Ahmed', 'Aisha', 'Hassan', 'Nadia', 'Mahmoud', 'Zeyneb', 'Salim', 'Mariam', 'Khaled', 'Yusuf', 'Rim', 'Hatem', 'Sonia', 'Bilel', 'Dorra', 'Fadi', 'Rania'];
const lastNames = ['Ben Youssef', 'Trabelsi', 'Bennour', 'Habib', 'Khaled', 'Bouajila', 'Maamri', 'Slama', 'Ben Ali', 'Trabelsi', 'Frikha', 'Souissi', 'Ben Salah', 'Amor', 'Haddad', 'Gharbi', 'Jaziri', 'Masmoudi', 'Saidi', 'Rezgui'];
const childNames = ['Ali', 'Sara', 'Yusuf', 'Maya', 'Noor', 'Ilyas', 'Othman', 'Hiba', 'Rayan', 'Meriem', 'Jawhar', 'Lamia', 'Ayoub', 'Ines', 'Mohamed'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const generateName = () => `${rand(firstNames)} ${rand(lastNames)}`;
const generateChildName = () => `${rand(childNames)}${Math.floor(Math.random() * 100)}`;

async function seedDemo() {
  try {
    const db = mongoose.connection.db;

    const usersCollection = db.collection('users');
    const organizationsCollection = db.collection('organizations');
    const childrenCollection = db.collection('children');
    const plansCollection = db.collection('specializedplans');
    const productsCollection = db.collection('marketplace_products');

    console.log('\n📋 Seeding CogniCare Demo Data (Production Scale)...\n');
    console.log(`Config: ${NUM_FAMILIES} families, ${CHILDREN_PER_FAMILY} children each, ${NUM_SPECIALISTS} specialists\n`);

    // 1. Organization
    console.log('1. Creating organization...');
    const orgFilter = { name: 'CogniCare Center Tunis' };
    let org = await organizationsCollection.findOne(orgFilter);
    if (!org) {
      const insertResult = await organizationsCollection.insertOne({
        name: 'CogniCare Center Tunis',
        description: "Centre de Rééducation et d'Accompagnement pour l'Autisme",
        country: 'Tunisia',
        city: 'Tunis',
        address: "123 Rue de l'Autism, Tunis 1000",
        phone: '+216 71 123 456',
        email: 'center@cognicare.tn',
        createdAt: new Date(),
        staffIds: [],
        familyIds: [],
        childrenIds: []
      });
      org = await organizationsCollection.findOne({ _id: insertResult.insertedId });
    }
    const orgId = org._id;
    console.log(`   ✓ Organization: ${orgId}`);

    // 2. Organization Leader (using ORIGINAL simple email)
    console.log('\n2. Creating organization leader...');
    const leaderFilter = { email: 'leader@cognicare.demo' };
    let leader = await usersCollection.findOne(leaderFilter);
    if (!leader) {
      const insertResult = await usersCollection.insertOne({
        fullName: 'Leïla Ben Salah',
        email: 'leader@cognicare.demo',
        passwordHash: DEMO_PASSWORD_HASH,
        role: 'organization_leader',
        organizationId: orgId,
        isConfirmed: true,
        profilePic: 'https://i.pravatar.cc/150?img=5',
        createdAt: new Date()
      });
      leader = await usersCollection.findOne({ _id: insertResult.insertedId });
    } else {
      await usersCollection.updateOne({ _id: leader._id }, {
        $set: { organizationId: orgId, passwordHash: DEMO_PASSWORD_HASH, isConfirmed: true }
      });
    }
    console.log(`   ✓ Leader: leader@cognicare.demo`);

    // 3. Specialists (60 specialists using ORIGINAL simple email pattern)
    console.log(`\n3. Creating ${NUM_SPECIALISTS} specialists...`);
    const specRoles = ['psychologist', 'psychologist', 'speech_therapist', 'occupational_therapist', 'doctor', 'volunteer'];
    const specNames = {
      psychologist: ['Dr. Mariam Khelifi', 'Dr. Fatima Khaled', 'Dr. Ahmed Bouajila', 'Dr. Youssef Meddeb', 'Dr. Lamia Gharbi'],
      speech_therapist: ['Aïsha Maamri', 'Hend Jaziri', 'Sonia Masmoudi', 'Rania Saidi'],
      occupational_therapist: ['Hassan Slama', 'Nadia Ben Ali', 'Karim Rezgui', 'Dorra Haddad'],
      doctor: ['Dr. Mahmoud Trabelsi', 'Dr. Zeyneb Frikha', 'Dr. Bilel Amor'],
      volunteer: ['Salim Souissi', 'Fadi Trabelsi', 'Hatem Ben Salah']
    };
    
    const specialists = [];
    const specialistIds = [];
    
    // First, create the key specialists with original emails
    const keySpecialists = [
      { email: 'psychologist@cognicare.demo', name: 'Dr. Mariam Khelifi', role: 'psychologist' },
      { email: 'speech@cognicare.demo', name: 'Aïsha Maamri', role: 'speech_therapist' },
      { email: 'occupational@cognicare.demo', name: 'Hassan Slama', role: 'occupational_therapist' },
      { email: 'doctor@cognicare.demo', name: 'Dr. Mahmoud Trabelsi', role: 'doctor' },
    ];
    
    for (const spec of keySpecialists) {
      const filter = { email: spec.email };
      let doc = await usersCollection.findOne(filter);
      if (!doc) {
        const insertResult = await usersCollection.insertOne({
          fullName: spec.name,
          email: spec.email,
          passwordHash: DEMO_PASSWORD_HASH,
          role: spec.role,
          organizationId: orgId,
          isConfirmed: true,
          profilePic: `https://i.pravatar.cc/150?u=${spec.email}`,
          createdAt: new Date()
        });
        doc = await usersCollection.findOne({ _id: insertResult.insertedId });
      }
      specialists.push(doc);
      specialistIds.push(doc._id);
      console.log(`   ✓ ${spec.role}: ${spec.email}`);
    }
    
    // Create remaining specialists
    for (let i = 0; i < NUM_SPECIALISTS - keySpecialists.length; i++) {
      const role = specRoles[i % specRoles.length];
      const names = specNames[role];
      const name = names[i % names.length] + ` ${Math.floor(i / names.length) + 1}`;
      const email = `spec${i}@cognicare.demo`;
      
      const filter = { email };
      let doc = await usersCollection.findOne(filter);
      if (!doc) {
        const insertResult = await usersCollection.insertOne({
          fullName: name,
          email,
          passwordHash: DEMO_PASSWORD_HASH,
          role,
          organizationId: orgId,
          isConfirmed: true,
          profilePic: `https://i.pravatar.cc/150?u=${email}`,
          createdAt: new Date()
        });
        doc = await usersCollection.findOne({ _id: insertResult.insertedId });
      }
      specialists.push(doc);
      specialistIds.push(doc._id);
    }
    console.log(`   ✓ Total specialists: ${specialists.length}`);

    // 4. Families (200 families)
    console.log(`\n4. Creating ${NUM_FAMILIES} families...`);
    const families = [];
    const familyIds = [];
    
    for (let i = 0; i < NUM_FAMILIES; i++) {
      const name = generateName();
      const email = `family${i}@cognicare.demo`;
      
      const filter = { email };
      let doc = await usersCollection.findOne(filter);
      if (!doc) {
        const insertResult = await usersCollection.insertOne({
          fullName: name,
          email,
          passwordHash: DEMO_PASSWORD_HASH,
          role: 'family',
          organizationId: orgId,
          isConfirmed: true,
          profilePic: `https://i.pravatar.cc/150?u=${email}`,
          createdAt: new Date()
        });
        doc = await usersCollection.findOne({ _id: insertResult.insertedId });
      }
      families.push(doc);
      familyIds.push(doc._id);
    }
    console.log(`   ✓ Total families: ${families.length}`);

    // 5. Children (600 children - 3 per family)
    console.log(`\n5. Creating ${NUM_FAMILIES * CHILDREN_PER_FAMILY} children...`);
    const children = [];
    const childIds = [];
    
    for (let i = 0; i < families.length; i++) {
      const family = families[i];
      for (let c = 0; c < CHILDREN_PER_FAMILY; c++) {
        const childName = generateChildName();
        const age = 3 + Math.floor(Math.random() * 8);
        const specialistIndex = Math.floor(Math.random() * specialists.length);
        const specialist = specialists[specialistIndex];
        
        const filter = { name: childName, familyId: family._id };
        let doc = await childrenCollection.findOne(filter);
        if (!doc) {
          const insertResult = await childrenCollection.insertOne({
            name: childName,
            age,
            diagnosis: 'Autism Spectrum Disorder',
            familyId: family._id,
            specialistId: specialist._id,
            organizationId: orgId,
            profilePicture: `https://i.pravatar.cc/150?u=${childName}`,
            medicalHistory: `Diagnosed at age ${Math.max(1, age - 2)}. Regular follow-up.`,
            createdAt: new Date()
          });
          doc = await childrenCollection.findOne({ _id: insertResult.insertedId });
        }
        children.push(doc);
        childIds.push(doc._id);
      }
    }
    console.log(`   ✓ Total children: ${children.length}`);

    // 6. Specialized Plans (2400 plans - 4 per child)
    console.log(`\n6. Creating therapy plans...`);
    const planTypes = ['PECS', 'TEACCH', 'SkillTracker', 'Activity'];
    const planDescriptions = {
      PECS: 'Picture Exchange Communication System - Visual communication cards',
      TEACCH: 'Structured teaching approach for autism',
      SkillTracker: 'Daily living skills development tracking',
      Activity: 'Therapeutic sensory and motor activities'
    };
    
    let planCount = 0;
    for (const child of children) {
      for (let p = 0; p < PLANS_PER_CHILD; p++) {
        const planType = planTypes[p % planTypes.length];
        const filter = { childId: child._id, planType, title: `${planType} Plan - ${child.name}` };
        
        let doc = await plansCollection.findOne(filter);
        if (!doc) {
          await plansCollection.insertOne({
            childId: child._id,
            organizationId: orgId,
            specialistId: child.specialistId,
            planType,
            title: `${planType} Plan - ${child.name}`,
            description: planDescriptions[planType],
            status: 'active',
            startDate: new Date(Date.now() - Math.floor(Math.random() * 60) * 24 * 60 * 60 * 1000),
            goals: [`${planType} skill goal 1`, `${planType} skill goal 2`, `${planType} skill goal 3`],
            sessions: 5 + Math.floor(Math.random() * 20),
            progress: Math.floor(Math.random() * 100),
            notes: `Auto-created ${planType} plan for ${child.name}`,
            createdAt: new Date()
          });
          planCount++;
        }
      }
    }
    console.log(`   ✓ Total plans created: ${planCount}`);

    // 7. Marketplace Products (300 products)
    console.log(`\n7. Creating marketplace products...`);
    const productNames = ['Sensory Toy', 'Weighted Blanket', 'Fidget Spinner', 'Noise-Canceling Headphones', 
      'Visual Schedule Board', 'Communication Cards', 'Therapy Swing', 'Balance Board', 'Chewelry Necklace',
      'Compression Vest', 'Sensory Balls', 'LED Bubble Tube', 'Tactile Mats', 'Cozy Corner Tent'];
    const categories = ['sensory', 'motor', 'cognitive', 'communication', 'therapy'];
    
    for (let i = 0; i < NUM_MARKET_ITEMS; i++) {
      const name = `${rand(productNames)} ${i + 1}`;
      const filter = { title: name };
      
      let doc = await productsCollection.findOne(filter);
      if (!doc) {
        await productsCollection.insertOne({
          title: name,
          description: `High quality ${name.toLowerCase()} for autism therapy and sensory support.`,
          price: 10 + Math.floor(Math.random() * 200),
          category: rand(categories),
          organizationId: orgId,
          images: [`https://picsum.photos/seed/${i}/400/300`],
          stock: 1 + Math.floor(Math.random() * 50),
          rating: 3 + Math.random() * 2,
          reviewCount: Math.floor(Math.random() * 100),
          createdAt: new Date()
        });
      }
    }
    console.log(`   ✓ Total products: ${NUM_MARKET_ITEMS}`);

    // 8. Update organization with all references
    console.log('\n8. Updating organization references...');
    await organizationsCollection.updateOne(
      { _id: orgId },
      {
        $set: {
          staffIds: specialistIds,
          familyIds: familyIds,
          childrenIds: childIds,
          leaderId: leader._id
        }
      }
    );
    console.log('   ✓ Organization updated with all references');

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('✅ DEMO DATA SEEDING COMPLETE');
    console.log('='.repeat(70));
    console.log('\n📊 Final Counts:');
    console.log(`   • Organization: 1 (CogniCare Center Tunis)`);
    console.log(`   • Staff: ${specialists.length} specialists`);
    console.log(`   • Families: ${families.length}`);
    console.log(`   • Children: ${children.length}`);
    console.log(`   • Therapy Plans: ${planCount}`);
    console.log(`   • Marketplace Products: ${NUM_MARKET_ITEMS}`);
    console.log('\n🔑 Demo Login Credentials (password: admin123):');
    console.log('   • Organization Leader: leader@cognicare.demo');
    console.log('   • Psychologist: psychologist@cognicare.demo');
    console.log('   • Speech Therapist: speech@cognicare.demo');
    console.log('   • Occupational Therapist: occupational@cognicare.demo');
    console.log('   • Doctor: doctor@cognicare.demo');
    console.log('   • Any other specialist: spec{N}@cognicare.demo');
    console.log('   • Any family: family{N}@cognicare.demo');
    console.log('='.repeat(70) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('✗ Seeding failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

connectDB().then(seedDemo);
