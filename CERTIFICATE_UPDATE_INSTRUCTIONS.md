# Instructions pour finaliser la mise à jour du certificat

## Modifications effectuées

1. ✅ Template HTML mis à jour (`assets/certificates/caregiver-certificate-template.html`)
   - Ajout du placeholder `{{LOGO_DATA_URI}}` pour le vrai logo
   - Ajout du placeholder `{{QR_CODE_DATA_URI}}` pour le QR code
   - Suppression du SVG placeholder et du texte "Scan at cognicare.app/verify"

2. ✅ Logo copié (`assets/certificates/app_logo.png`)
   - Le logo de l'application a été copié depuis le frontend

3. ✅ Code backend modifié (`src/volunteers/volunteers.service.ts`)
   - Ajout de la fonction `_getLogoDataUri()` pour charger le logo
   - Ajout de la fonction `_generateQrCodeDataUri()` pour générer le QR code
   - Mise à jour de `_renderCertificateHtml()` pour inclure les nouveaux tokens

## Action requise

### Installation du package qrcode

Exécutez la commande suivante dans le dossier backend:

```bash
cd backend
npm install qrcode @types/qrcode --save
```

### Vérification

Après l'installation, vérifiez que tout fonctionne:

```bash
npm run build
npm run start:dev
```

### Test

1. Connectez-vous en tant que volontaire
2. Allez dans la section Formations
3. Ouvrez votre certificat
4. Cliquez sur le bouton de téléchargement
5. Vérifiez que le PDF téléchargé contient:
   - Le vrai logo CogniCare (au centre)
   - Le QR code (en bas à droite)
   - Tous les autres éléments du design

## Résultat attendu

Le certificat PDF téléchargé doit maintenant être identique au certificat affiché dans l'application Flutter, avec:
- Les coins dorés décoratifs
- Le titre bilingue (anglais/français)
- Le nom de l'utilisateur en grand
- Le score du quiz
- La signature du superviseur
- **Le vrai logo CogniCare** (au lieu du SVG placeholder)
- La date d'émission
- L'ID du certificat
- **Le QR code** (au lieu du texte "Scan at cognicare.app/verify")
