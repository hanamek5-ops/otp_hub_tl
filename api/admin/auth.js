export default async function handler(req, res) {
    const { password } = req.body || {};
    if (password && password === process.env.ADMIN_SECRET_KEY) {
        return res.status(200).json({ token: Buffer.from(password).toString('base64') });
    }
    return res.status(401).json({ error: 'Mật khẩu sai' });
}