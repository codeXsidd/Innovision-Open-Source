import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

let adminDb = null;

function initializeFirebaseAdmin() {
  if (adminDb) return adminDb;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("Firebase Admin SDK: Missing credentials. Server-side database operations will be limited.");
    console.warn("Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY");
    return null;
  }

  if (!getApps().length) {
    try {
      initializeApp({
        credential: cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
      });
      console.log("Firebase Admin initialized successfully");
      adminDb = getFirestore();
    } catch (error) {
      console.error("Firebase Admin initialization failed:", error.message);
      return null;
    }
  } else {
    try {
      adminDb = getFirestore();
    } catch (error) {
      console.error("Firebase getFirestore failed:", error.message);
      return null;
    }
  }

  return adminDb;
}

initializeFirebaseAdmin();
export function getAdminDb() {
  if (!adminDb) {
    return initializeFirebaseAdmin();
  }
  return adminDb;
}
export { adminDb, FieldValue };