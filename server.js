const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- Datenbank Helfer ---
const loadDatabase = () => {
    if (!fs.existsSync(DB_FILE)) return { attendance: {} };
    return JSON.parse(fs.readFileSync(DB_FILE));
};

const saveDatabase = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// --- API Endpoints ---

// 1. Liste laden
app.get('/api/attendance/:date/:period', (req, res) => {
    const { date, period } = req.params;
    const db = loadDatabase();
    const key = `${date}_${period}`;
    // Wenn keine Liste existiert, leeres Array zurückgeben
    res.json(db.attendance[key] || []);
});

// 2. Liste speichern
app.post('/api/attendance', (req, res) => {
    const { date, period, list } = req.body;
    const db = loadDatabase();
    const key = `${date}_${period}`;
    
    db.attendance[key] = list;
    saveDatabase(db);
    res.json({ success: true });
});

// 3. Matrix Daten für PDF Export generieren
// Sammelt alle eindeutigen Schüler der Woche und füllt ihre 40 Slots
app.post('/api/matrix', (req, res) => {
    const { weekDates } = req.body; // Array [Mo, Di, Mi, Do, Fr] (YYYY-MM-DD)
    const db = loadDatabase();
    
    // 1. Alle eindeutigen Schülernamen in dieser Woche finden
    const studentMap = new Map(); // Name -> { name, presentStats: {} }

    weekDates.forEach((date, dayIndex) => {
        for (let p = 1; p <= 8; p++) {
            const key = `${date}_${p}`;
            const list = db.attendance[key] || [];
            
            list.forEach(student => {
                if (!studentMap.has(student.name)) {
                    studentMap.set(student.name, {
                        name: student.name,
                        slots: {} // key: "dayIndex_period" (z.B. "0_1" für Mo 1. Std)
                    });
                }
                // Status speichern: true (anwesend), false (abwesend)
                const s = studentMap.get(student.name);
                s.slots[`${dayIndex}_${p}`] = student.present;
            });
        }
    });

    // In Array umwandeln und sortieren
    const matrix = Array.from(studentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.json(matrix);
});

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});


