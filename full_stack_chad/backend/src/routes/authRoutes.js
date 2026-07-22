import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export function authRoutes({ repository, config }) {
  const router = express.Router();

  router.post('/login', async (req, res, next) => {
    try {
      if (config.supabaseConfigured) {
        return res.status(409).json({ error: 'Use Supabase authentication for this environment' });
      }

      const input = schema.parse(req.body);
      const user = await repository.findUserByEmail(input.email);
      if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
        return res.status(401).json({ error: 'Email or password is incorrect' });
      }

      const profile = { id: user.id, email: user.email, role: user.role, name: user.name };
      const token = jwt.sign(profile, config.jwtSecret, { expiresIn: '8h' });
      res.json({ token, user: profile });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
