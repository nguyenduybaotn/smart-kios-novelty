import jwt from 'jsonwebtoken';

export function signUser(user){
  return jwt.sign({ userId:user.UserId, username:user.Username, fullName:user.FullName, role:user.Role }, process.env.JWT_SECRET || 'vision-ai-kiosk-secret', { expiresIn:'12h' });
}

export function requireAuth(req,res,next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if(!token) return res.status(401).json({ message:'Chưa đăng nhập' });
  try{
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'vision-ai-kiosk-secret');
    next();
  }catch{
    return res.status(401).json({ message:'Phiên đăng nhập hết hạn hoặc không hợp lệ' });
  }
}
