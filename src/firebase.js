import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

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
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const storage = getStorage(app);
export const analytics = getAnalytics(app);
