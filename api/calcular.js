const { calculateForRequest } = require('../calculator');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        res.end('Method Not Allowed');
        return;
    }

    try {
        const payload = req.body && Object.keys(req.body).length ? req.body : await parseBody(req);
        const result = calculateForRequest(payload);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
    } catch (err) {
        const status = err.status || 500;
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message || 'Error interno' }));
    }
};

async function parseBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}
