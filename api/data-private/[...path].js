// Bloquea acceso directo a los JSON de data-private
module.exports = (req, res) => {
    res.status(404).json({ error: 'Not found' });
};
