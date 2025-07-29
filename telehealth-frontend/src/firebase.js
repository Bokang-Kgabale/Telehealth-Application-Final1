// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
//hide config details in production
const firebaseConfig = {
  apiKey: "AIzaSyAf2iPhHlgn6QxagOJ8VAz6UwEk4yUMLnU",
  authDomain: "fir-rtc-521a2.firebaseapp.com",
  projectId: "fir-rtc-521a2",
  storageBucket: "fir-rtc-521a2.firebasestorage.app",
  messagingSenderId: "599476304901",
  appId: "1:599476304901:web:722c59b1022b85a249b06c",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);