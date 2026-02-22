import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyDwzvz8aaJ_6_5PuZg7o6cJvUtFfACfdD0",
    authDomain: "classitra-app.firebaseapp.com",
    projectId: "classitra-app",
    storageBucket: "classitra-app.firebasestorage.app",
    messagingSenderId: "181515507878",
    appId: "1:181515507878:web:0d7ba9ad900f2b92247c67",
    measurementId: "G-CXJJPD8Z90"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
