import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// This tells Vite to look for environment variables prefixed with "VITE_"
// In production (Netlify), we will set these variables in the site's dashboard.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

// For local development, you can create a .env.local file.
// For now, we will add the keys directly in Netlify.

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);