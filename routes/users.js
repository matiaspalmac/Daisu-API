    import express from 'express';
    import { db } from '../db.js';

    const router = express.Router();

    // Create a user
    router.post('/createuser', async (req, res) => {
        console.log('Creating user:', req.body);
        const { name, email, image } = req.body;
        try {
            const userExists = await db.execute({
                sql: 'SELECT id FROM users WHERE email = :email',
                args: { email },
            });

            if (userExists.rows.length > 0) {
                res.status(200).send('User already exists');
                return;
            }

            await db.execute({
                sql: 'INSERT INTO users (name, email, image, isAdmin, bio, nativelang, learninglang) VALUES (:name, :email, :image, false, "", "", "")',
                args: { name, email, image },
            });
            res.status(200).send('User added successfully');
        } catch (e) {
            console.error(e);
            res.status(500).send('Error adding user');
        }
    });

// Update a user
router.put('/updateuser', async (req, res) => {
    const { id, name, email, image, isAdmin, bio, nativelang, learninglang } = req.body;
    console.log('Updating user with ID:', id);

    if (!id) {
        return res.status(400).send('User ID is required');
    }

    try {
        await db.execute({
            sql: 'UPDATE users SET name = :name, email = :email, image = :image, isAdmin = :isAdmin, bio = :bio, nativelang = :nativelang, learninglang = :learninglang WHERE id = :id',
            args: { name, email, image, isAdmin, bio, nativelang, learninglang, id },
        });
        res.status(200).send('User updated successfully');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error updating user');
    }
});

    // Get all users
    router.get('/getusers', async (req, res) => {
        console.log('Fetching all users');
        try {
            const result = await db.execute(
                'SELECT id, name, email, image, isAdmin, bio, nativelang, learninglang, created_at FROM users'
            );
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // Delete a user
    router.delete('/updateusers/:id', async (req, res) => {
        console.log('Deleting user with ID:', req.params);
        const { id } = req.params;
        try {
            await db.execute({
                sql: 'DELETE FROM users WHERE id = :id',
                args: { id },
            });
            res.status(200).send('User deleted successfully');
        } catch (e) {
            console.error(e);
            res.status(500).send('Error deleting user');
        }
    });

    export default router;
