/**
 * Firebase Admin SDK — singleton initializer
 *
 * Reads credentials from env:
 *   FIREBASE_SERVICE_ACCOUNT  = full service-account JSON string (recommended for Vercel)
 *   OR
 *   FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 */

import * as admin from "firebase-admin"

let initialized = false

export function getFirebaseApp(): admin.app.App {
  if (initialized) return admin.app()

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
  const projectId = process.env.FIREBASE_PROJECT_ID || "gemini2-466412"

  if (!admin.apps.length) {
    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson)
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      })
    } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      })
    } else {
      // Application Default Credentials (works on Google Cloud / Firebase Hosting)
      admin.initializeApp({ projectId })
    }
  }

  initialized = true
  return admin.app()
}

export function getFirestore(): admin.firestore.Firestore {
  return getFirebaseApp().firestore()
}
