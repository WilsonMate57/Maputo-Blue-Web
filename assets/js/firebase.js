// ─────────────────────────────────────────────────────────────────────────────
// firebase.js  —  Initialise Firebase app & export Firestore db
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyC2xFXyIK_jZNUZLw0rPoTO_A0XbZW0tgQ",
  authDomain:        "maputo-blue-web.firebaseapp.com",
  projectId:         "maputo-blue-web",
  storageBucket:     "maputo-blue-web.firebasestorage.app",
  messagingSenderId: "894623223812",
  appId:             "1:894623223812:web:a440d4737d5ba965e8a551",
  measurementId:     "G-M5M3635SH4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
