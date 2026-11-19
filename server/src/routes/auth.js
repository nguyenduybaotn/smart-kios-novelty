import express from 'express';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../db/pool.js';
import { signUser, requireAuth } from '../middleware.auth.js';
const router = express.Router();

router.post('/login', async (req,res,next)=>{
  try{
    const { username, password } = req.body;
    const pool = await getPool();
    const rs = await pool.request().input('u',sql.NVarChar,username||'')
      .query('SELECT TOP 1 * FROM Users WHERE Username=@u AND IsActive=1');
    const user = rs.recordset[0];
    if(!user) return res.status(401).json({ message:'Sai tài khoản hoặc mật khẩu' });
    const ok = String(user.PasswordHash||'').startsWith('plain:') ? String(user.PasswordHash).slice(6)===(password||'') : await bcrypt.compare(password || '', user.PasswordHash);
    if(!ok) return res.status(401).json({ message:'Sai tài khoản hoặc mật khẩu' });
    const token = signUser(user);
    await pool.request().input('id',sql.Int,user.UserId).query('UPDATE Users SET LastLoginAt=SYSUTCDATETIME() WHERE UserId=@id');
    res.json({ token, user:{ userId:user.UserId, username:user.Username, fullName:user.FullName, role:user.Role } });
  }catch(e){next(e)}
});

router.get('/me', requireAuth, (req,res)=>res.json({ user:req.user }));

router.get('/users', requireAuth, async (req,res,next)=>{
  try{ const pool=await getPool(); const rs=await pool.request().query('SELECT UserId, Username, FullName, Role, Phone, IsActive, LastLoginAt, CreatedAt FROM Users ORDER BY CreatedAt DESC'); res.json(rs.recordset); }catch(e){next(e)}
});

router.post('/users', requireAuth, async (req,res,next)=>{
  try{
    const { username, password, fullName, role, phone, isActive=true } = req.body;
    if(!username || !password || !fullName) return res.status(400).json({ message:'Thiếu tài khoản, mật khẩu hoặc họ tên' });
    const hash = await bcrypt.hash(password, 10);
    const pool=await getPool();
    await pool.request().input('Username',sql.NVarChar,username).input('PasswordHash',sql.NVarChar,hash).input('FullName',sql.NVarChar,fullName).input('Role',sql.NVarChar,role||'PACKER').input('Phone',sql.NVarChar,phone||null).input('IsActive',sql.Bit,!!isActive)
      .query('INSERT INTO Users(Username,PasswordHash,FullName,Role,Phone,IsActive) VALUES(@Username,@PasswordHash,@FullName,@Role,@Phone,@IsActive)');
    res.json({ ok:true });
  }catch(e){next(e)}
});

export default router;
