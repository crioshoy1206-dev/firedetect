const express = require('express');
const admin = require('firebase-admin');

// 1. Firebase 서비스 계정 키 파싱 및 환경 변수 검증
let serviceAccount;
let isFirebaseInitialized = false;

try {
    const privateKeyString = process.env.FIREBASE_PRIVATE_KEY;

    if (!privateKeyString) {
        throw new Error("FIREBASE_PRIVATE_KEY 환경 변수가 설정되지 않았습니다. Vercel 설정을 확인하세요.");
    }

    serviceAccount = JSON.parse(privateKeyString);
    console.log("✅ 1. JSON.parse 성공. 서비스 계정 객체 생성됨.");

    if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
        const key = serviceAccount.private_key;

        const HEADER = '-----BEGIN PRIVATE KEY-----';
        const FOOTER = '-----END PRIVATE KEY-----';

        const PEM_REGEX = new RegExp(`^\\s*${HEADER}\\s*([\\s\\S]*?)\\s*${FOOTER}\\s*$`);
        const match = key.match(PEM_REGEX);

        if (match && match[1]) {
            console.log("✅ 2. PEM Header/Footer 정규식 매칭 성공.");
            
            let cleanBase64Data = match[1].replace(/[^a-zA-Z0-9+/=]/g, '');

            while (cleanBase64Data.length % 4 !== 0) {
                cleanBase64Data += '=';
            }
            
            serviceAccount.private_key =
                `${HEADER}\n` +
                cleanBase64Data +
                `\n${FOOTER}`;
            
            console.log(`✅ 3. Private Key Base64 데이터 클리닝 및 재조립 성공.`);
            
        } else {
            console.error("❌ Critical: Private key headers/footers not found.");
            throw new Error("Private Key structure is invalid (missing BEGIN/END markers).");
        }
    }

} catch (error) {
    console.error("🚨 Firebase Key 파싱 또는 PEM 형식 오류:", error.message);
    console.error("Vercel 환경 변수 'FIREBASE_PRIVATE_KEY' 값이 올바른 전체 JSON 객체인지 확인해주세요.");
}

// 2. Firebase Admin SDK 초기화
if (serviceAccount && admin.apps.length === 0) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: `https://${serviceAccount.project_id}.firebaseio.com` 
        });
        isFirebaseInitialized = true;
        console.log(`🚀 Firebase Admin SDK 초기화 성공 (Project: ${serviceAccount.project_id})`);
    } catch(initError) {
        console.error('🔥 Firebase Admin SDK 초기화 중 최종 실패 (Admin SDK 오류):', initError.message);
    }
} else if (admin.apps.length > 0) {
    isFirebaseInitialized = true;
    console.log("⚠️ Firebase Admin SDK는 이미 초기화되어 있습니다.");
}

const db = isFirebaseInitialized ? admin.firestore() : null;
const app = express();

app.use(express.json());

/**
 * 💡 Firebase 초기화 확인 미들웨어: 초기화 실패 시 500 오류 반환
 */
app.use((req, res, next) => {
    if (!isFirebaseInitialized || !db) {
        console.error('🚨 API 호출 거부: Firebase Admin SDK 초기화 실패 상태.');
        return res.status(500).json({ 
            error: "서버 설정 오류 (Firebase)", 
            message: "백엔드 서버가 Firebase 인증에 실패하여 데이터를 불러올 수 없습니다. Vercel 로그를 확인하여 FIREBASE_PRIVATE_KEY 환경 변수 오류를 해결해야 합니다." 
        });
    }
    next();
});


/**
 * 💡 GET /api/data: 세 가지 컬렉션의 데이터를 모두 불러와 하나의 객체로 반환
 */
app.get('/api/data', async (req, res) => {
    try {
        const [
            sensorSnapshot, 
            citizenSnapshot, 
            preReportSnapshot
        ] = await Promise.all([
            db.collection('sensorData').get(),
            db.collection('citizenReports').get(),
            db.collection('preReports').get()
        ]);
        
        const sensorData = sensorSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const citizenReports = citizenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const preReports = preReportSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        res.json({
            sensorData,
            citizenReports,
            preReports
        }); 
    } catch (error) {
        console.error('🔥 Error fetching combined data from Firebase:', error);
        res.status(500).json({ error: "Error fetching combined data from Firebase" });
    }
});


/**
 * 💡 POST /api/add/sensor: 직접 감지 값 (시뮬레이션) 저장
 */
app.post('/api/add/sensor', async (req, res) => {
    try {
        const { lat, lon, smoke, temp, humidity, time } = req.body;
        if (lat === undefined || lon === undefined || smoke === undefined || temp === undefined) {
            return res.status(400).json({ error: "Missing required fields for sensor data" });
        }
        
        const newDoc = {
            lat, lon, 
            smoke: parseFloat(smoke), 
            temp: parseFloat(temp), 
            humidity: parseFloat(humidity || 0), 
            time: parseInt(time) || Date.now(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('sensorData').add(newDoc);
        res.status(201).json({ message: "Sensor data added", id: docRef.id });

    } catch (error) {
        console.error('🔥 Error adding sensor data:', error);
        res.status(500).json({ error: "Error adding sensor data" });
    }
});


/**
 * 💡 POST /api/add/citizen: 시민 신고 값 저장
 */
app.post('/api/add/citizen', async (req, res) => {
    try {
        const { lat, lon, time } = req.body;
        if (lat === undefined || lon === undefined) {
            return res.status(400).json({ error: "Missing required fields for citizen report" });
        }
        
        const newDoc = {
            lat, lon, 
            time: parseInt(time) || Date.now(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('citizenReports').add(newDoc);
        res.status(201).json({ message: "Citizen report added", id: docRef.id });

    } catch (error) {
        console.error('🔥 Error adding citizen report:', error);
        res.status(500).json({ error: "Error adding citizen report" });
    }
});


/**
 * 💡 POST /api/add/pre: 소각 사전 신고 정보 저장
 */
app.post('/api/add/pre', async (req, res) => {
    try {
        const { lat, lon, startDate, endDate, rangeKm } = req.body;
        if (lat === undefined || lon === undefined || startDate === undefined || endDate === undefined) {
            return res.status(400).json({ error: "Missing required fields for pre-report" });
        }
        
        const newDoc = {
            lat, lon, 
            startDate: parseInt(startDate),
            endDate: parseInt(endDate),
            rangeKm: parseFloat(rangeKm || 0.1),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('preReports').add(newDoc);
        res.status(201).json({ message: "Pre-report added", id: docRef.id });

    } catch (error) {
        console.error('🔥 Error adding pre-report:', error);
        res.status(500).json({ error: "Error adding pre-report" });
    }
});

module.exports = app;
