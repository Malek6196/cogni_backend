# CogniCare Backend

NestJS API for the CogniCare healthcare platform.

## Architecture

- **Framework**: NestJS 10.x with Express
- **Database**: MongoDB 6.0+ with Mongoose ODM
- **Authentication**: JWT with refresh tokens
- **Real-time**: Socket.IO for chat and appointments
- **File Storage**: Cloudinary
- **Email**: Nodemailer with SendGrid

## Setup

```bash
npm install
cp .env.example .env
npm run build
npm run start:dev
```

## Environment Variables

Core variables include:

- `MONGODB_URI`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID` (or `GOOGLE_CLIENT_IDS` comma-separated)

## Development

```bash
# Development with hot reload
npm run start:dev

# Debug mode
npm run start:debug

# Production build
npm run build
npm run start:prod
```

## Testing

```bash
# Unit tests
npm test

# e2e tests
npm run test:e2e

# Coverage
npm run test:cov

# Linting
npm run lint
```

## Project Structure

```
src/
├── auth/               # Authentication & authorization
├── users/              # User management
├── children/           # Child profiles
├── organization/       # Organization management
├── conversations/      # Chat messaging
├── appointments/       # Scheduling
├── calls/              # Video calls
├── progress-ai/        # AI recommendations
├── volunteers/         # Volunteer applications
├── courses/            # Training courses
├── healthcare-cabinets/ # Medical records
├── notifications/      # Push/email notifications
├── mail/               # Email service
├── cloudinary/         # File uploads
└── common/             # Guards, interceptors, pipes
```

## Key Patterns

### Authorization

```typescript
// Always verify authorization
const child = await this.childModel.findById(childId);
const isParent = child.parentId?.toString() === userId;
const isSpecialist = child.specialistId?.toString() === userId;
if (!isParent && !isSpecialist) {
  throw new ForbiddenException('Not authorized');
}
```

### Organization Scoping

```typescript
const filter: FilterQuery<PlanDocument> = { status: 'active' };
if (organizationId) {
  filter.$or = [
    { organizationId: new Types.ObjectId(organizationId) },
    { organizationId: { $exists: false } },
  ];
}
```

### Quiz Monitoring (Training)

```typescript
// Never trust client identity fields in behavior payloads.
// Use authenticated user id from JWT and server-side re-scoring.
async analyzeSession(userId: string, dto: AnalyzeQuizSessionDto) {
  const mergedFlags = this.deriveFlags(dto.behaviorSummary, dto.attentionData);
  const engagement = this.serverSideEngagement(dto, mergedFlags);
  const reliability = this.serverSideReliability(dto, mergedFlags);
  return this.sessionAnalysisModel.findOneAndUpdate(
    { userId, quizId: dto.quizId },
    { $set: { engagementScore: engagement, reliabilityScore: reliability } },
    { upsert: true, new: true, lean: true },
  );
}
```

### Secure Social Login (Google)

```typescript
// Client sends provider ID token only; backend verifies it.
const identity = await socialTokenVerifier.verifySocialIdToken(provider, idToken);
// Only verified claims are trusted for user linking/creation.
const user = await findOrCreateUserFromVerifiedIdentity(identity);
return issueAccessAndRefreshTokens(user);
```

- Endpoint: `POST /api/v1/auth/social-login`
- Security rule: never trust identity fields from client payload unless token is server-verified.

### Caregiver Certificate Generation

- Caregiver certificate PDFs are generated server-side from trusted user data (`fullName` from JWT-linked user).
- Template source: `backend/assets/certificates/caregiver-certificate-template.pdf`
- Optional env override: `CAREGIVER_CERTIFICATE_TEMPLATE_PATH`
- Generated certificate metadata and URL are stored on volunteer application records.

## API Documentation

See `../project-architecture/API_MAP.md` for endpoint documentation.

## Security

See `../SECURITY.md` and `../project-architecture/AUTH_AND_SECURITY.md`.

Production reminders:

- `JWT_SECRET`, `CHATBOT_CONFIRM_SECRET`, and `MESSAGES_ENCRYPTION_KEY` must be set before startup in production
- Swagger stays disabled in production unless `SWAGGER_ENABLED=true` is set intentionally
- `CORS_ORIGIN` must include the public web origin so both REST and websocket flows work correctly

## Deployment

The backend deploys automatically to Render on main branch pushes.

Configuration in `render.yaml` and `../.github/workflows/ci.yml`.
