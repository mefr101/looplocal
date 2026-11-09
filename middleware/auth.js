// Route guards. Use these in routes/ to protect endpoints.

export function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}

/** Allow only the listed roles, e.g. requireRole('admin') or requireRole('org_manager', 'admin'). */
export function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: 'Please sign in first.' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
    next();
  };
}
