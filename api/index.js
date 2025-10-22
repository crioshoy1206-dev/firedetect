import express from 'express';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, query, where, orderBy } from 'firebase/firestore';
import { getAuth, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

// --- ⚠️ 필수 전역 변수 초기화 ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Firebase 초기화
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// 사용자 인증 및 초기화 함수
const authenticate = async () => {
    try {
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }
        console.log("Firebase Auth initialized successfully.");
    } catch (error) {
        console.error("Firebase authentication error:", error);
    }
};

authenticate(); 

// ------------------------------------------------------------------
// 1. 공통 데이터베이스 경로 설정
// ------------------------------------------------------------------

// 모든 사용자가 데이터를 공유하는 공용 데이터 경로를 사용합니다.
const getCollectionPath = (collectionName) => {
    return `artifacts/${appId}/public/data/${collectionName}`;
};

const SENSOR_COLLECTION = getCollectionPath('sensorData');
const CITIZEN_COLLECTION = getCollectionPath('citizenReports');
const PRE_REPORT_COLLECTION = getCollectionPath('preReports');

// ------------------------------------------------------------------
// 2. 데이터 등록 (POST) 엔드포인트
// ------------------------------------------------------------------

// POST /api/add/sensor: 직접 감지 데이터 추가
app.post('/api/add/sensor', async (req, res) => {
    try {
        const data = { 
            ...req.body, 
            time: Date.now(), // 서버 시간으로 덮어쓰기
            lat: parseFloat(req.body.lat),
            lon: parseFloat(req.body.lon),
            smoke: parseFloat(req.body.smoke),
            temp: parseFloat(req.body.temp)
        };
        await addDoc(collection(db, SENSOR_COLLECTION), data);
        res.status(201).json({ message: 'Sensor data added successfully' });
    } catch (error) {
        console.error("Error adding sensor data: ", error);
        res.status(500).json({ error: 'Failed to add sensor data' });
    }
});

// POST /api/add/citizen: 시민 신고 데이터 추가
app.post('/api/add/citizen', async (req, res) => {
    try {
        const data = { 
            ...req.body, 
            time: Date.now(), // 서버 시간으로 덮어쓰기
            lat: parseFloat(req.body.lat),
            lon: parseFloat(req.body.lon)
        };
        // ⚠️ 여기서 citizenReports 컬렉션에 데이터가 정상적으로 저장되는지 확인해 주세요.
        await addDoc(collection(db, CITIZEN_COLLECTION), data);
        res.status(201).json({ message: 'Citizen report added successfully' });
    } catch (error) {
        console.error("Error adding citizen report: ", error);
        res.status(500).json({ error: 'Failed to add citizen report' });
    }
});

// POST /api/add/pre: 사전 신고 데이터 추가
app.post('/api/add/pre', async (req, res) => {
    try {
        const data = { 
            ...req.body, 
            lat: parseFloat(req.body.lat),
            lon: parseFloat(req.body.lon),
            rangeKm: parseFloat(req.body.rangeKm),
            startDate: req.body.startDate, // Unix Milliseconds
            endDate: req.body.endDate // Unix Milliseconds
        };
        // ⚠️ 여기서 preReports 컬렉션에 데이터가 정상적으로 저장되는지 확인해 주세요.
        await addDoc(collection(db, PRE_REPORT_COLLECTION), data);
        res.status(201).json({ message: 'Pre-report added successfully' });
    } catch (error) {
        console.error("Error adding pre-report: ", error);
        res.status(500).json({ error: 'Failed to add pre-report' });
    }
});


// ------------------------------------------------------------------
// 3. 데이터 조회 (GET) 엔드포인트 (핵심 수정 부분)
// ------------------------------------------------------------------

/**
 * GET /api/stream/sensor
 * 지도에 표시할 모든 데이터를 한 번에 가져옵니다. (센서, 시민 신고, 사전 신고)
 */
app.get('/api/stream/sensor', async (req, res) => {
    try {
        const timeLimit = Date.now() - (24 * 60 * 60 * 1000); // 24시간 이내 데이터만 조회

        // 1. 센서 데이터 (sensorData) 조회
        const sensorQuery = query(
            collection(db, SENSOR_COLLECTION),
            where('time', '>', timeLimit)
            // orderBy('time', 'desc') // 성능 문제로 orderBy는 클라이언트에서 처리 권장
        );
        const sensorSnapshot = await getDocs(sensorQuery);
        const sensorData = sensorSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 2. 시민 신고 데이터 (citizenReports) 조회
        // ⚠️ 이 부분이 핵심입니다. 컬렉션 경로가 정확하고 데이터가 존재하는지 확인!
        const citizenQuery = query(
            collection(db, CITIZEN_COLLECTION),
            where('time', '>', timeLimit)
        );
        const citizenSnapshot = await getDocs(citizenQuery);
        const citizenReports = citizenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // 3. 사전 신고 데이터 (preReports) 조회
        // ⚠️ 이 부분이 핵심입니다. 현재 유효한 사전 신고 (종료 시간 < 현재 시간)만 조회하는 쿼리
        const preReportQuery = query(
            collection(db, PRE_REPORT_COLLECTION),
            where('endDate', '>', Date.now()) // 아직 종료되지 않은 신고만 가져옴
        );
        const preReportSnapshot = await getDocs(preReportQuery);
        const preReports = preReportSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));


        // 모든 데이터를 하나로 묶어 프론트엔드에 응답
        res.status(200).json({
            sensorData,
            citizenReports, // <--- 이 배열이 비어있다면 프론트엔드에 표시되지 않습니다.
            preReports      // <--- 이 배열이 비어있다면 지도에 원이 표시되지 않습니다.
        });

    } catch (error) {
        console.error("Error fetching all data (citizen, pre, sensor): ", error);
        // 에러 발생 시 빈 배열을 반환하여 지도 작동은 유지하도록 처리
        res.status(500).json({ 
            error: 'Failed to fetch data', 
            sensorData: [], 
            citizenReports: [], 
            preReports: [] 
        });
    }
});

// ------------------------------------------------------------------
// 4. 서버 시작
// ------------------------------------------------------------------
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
