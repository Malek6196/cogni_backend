Place the caregiver certificate template here.

Preferred for clean dynamic rendering (no placeholder overlap):

- `caregiver-certificate-template.html` (HTML/CSS template with tokens)

Supported fallback assets:

- `caregiver-certificate-template.pdf` (preferred)
- `caregiver-certificate-template.png`
- `caregiver-certificate-template.jpg`
- `Caregiver Certification Certificate-2.pdf`

Default lookup order used by backend:

1. `backend/assets/certificates/caregiver-certificate-template.html`
2. `backend/assets/certificates/Caregiver Certification Certificate-2.pdf`
3. `backend/assets/certificates/caregiver-certificate-template.pdf`
4. `backend/assets/certificates/caregiver-certificate-template.png`
5. `backend/assets/certificates/caregiver-certificate-template.jpg`

HTML template tokens:

- `{{FULL_NAME}}`
- `{{QUIZ_SCORE}}`
- `{{ORGANIZATION}}`
- `{{CERTIFICATE_ID}}`
- `{{ISSUE_DATE}}`
- `{{SUPERVISOR_NAME}}`
- `{{AUTHORITY_NAME}}`

You can override it with environment variable:

`CAREGIVER_CERTIFICATE_TEMPLATE_PATH=/absolute/path/to/template.(html|pdf|png|jpg)`
