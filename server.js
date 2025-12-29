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
    try {
        return JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) {
        return { attendance: {} };
    }
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
    // Standardmäßig leeres Array senden, damit Frontend nicht abstürzt
    res.json(db.attendance[key] || []);
});

// 2. Liste speichern
app.post('/api/attendance', (req, res) => {
    try {
        const { date, period, list } = req.body;
        const db = loadDatabase();
        const key = `${date}_${period}`;
        
        db.attendance[key] = list;
        saveDatabase(db);
        res.json({ success: true });
    } catch (error) {
        console.error("Fehler beim Speichern:", error);
        res.status(500).json({ error: "Speichern fehlgeschlagen" });
    }
});

// 3. Matrix Daten für PDF Export
app.post('/api/matrix', (req, res) => {
    const { weekDates } = req.body; // Array [Mo, Di, Mi, Do, Fr]
    const db = loadDatabase();
    
    // Wir sammeln alle Schüler, die in irgendeiner Stunde dieser Woche vorkommen
    const studentMap = new Map(); 

    if (weekDates && Array.isArray(weekDates)) {
        weekDates.forEach((date, dayIndex) => {
            for (let p = 1; p <= 8; p++) {
                const key = `${date}_${p}`;
                const list = db.attendance[key] || [];
                
                list.forEach(student => {
                    // Wir identifizieren Schüler am Namen
                    if (!studentMap.has(student.name)) {
                        studentMap.set(student.name, {
                            name: student.name,
                            slots: {} 
                        });
                    }
                    const s = studentMap.get(student.name);
                    // dayIndex (0-4) und period (1-8) als Key
                    s.slots[`${dayIndex}_${p}`] = student.present;
                });
            }
        });
    }

    // Sortieren nach Name
    const matrix = Array.from(studentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    res.json(matrix);
});

app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});


