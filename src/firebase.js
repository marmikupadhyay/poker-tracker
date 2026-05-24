import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  projectId: "poker-tracker-1506015015",
  appId: "1:552635929842:web:be9edc839980709ad06c6b",
  storageBucket: "poker-tracker-1506015015.firebasestorage.app",
  apiKey: "AIzaSyA4kvUOIVkkgTGfD-48u7rmoi5aj1oD4_0",
  authDomain: "poker-tracker-1506015015.firebaseapp.com",
  messagingSenderId: "552635929842"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
