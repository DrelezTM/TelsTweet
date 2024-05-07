const express = require('express');
const mysql = require('mysql');
const session = require('express-session');
const multer = require('multer');
const { createServer } = require('http');
const bcrypt = require('bcryptjs');

const app = express();
const server = createServer(app);

app.set('view engine', 'ejs');
app.use(express.json());
app.use(require('body-parser').urlencoded({ limit: '50mb', extended: true }));
app.use(require('body-parser').json({ limit: '50mb' }));
app.use(session({
	secret: 'secret',
	resave: true,
	saveUninitialized: true,
    cookie: { secure: false }
}));

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'telstweet'
});

connection.connect((err) => {
    if (err) throw err;
    console.log('[WEB] Connected to MySQL');
});

app.use(express.static('public'));

const profileStorage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'public/profile/');
    },
    filename: function(req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + '.' + file.originalname.split('.').pop());
    }
});

const postStorage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'public/post/');
    },
    filename: function(req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + '.' + file.originalname.split('.').pop());
    }
});

let expiredReset = [];
const profileUpload = multer({ storage: profileStorage });
const postUpload = multer({ storage: postStorage });

app.get('/', async (req, res) => {
    res.redirect('/home');
});


app.get('/password/current', async (req, res) => {
    if (!req.session.loggedin) return res.redirect('/logout');
    res.render('pages/currentPassword', { errorMessage: null });
});

app.post('/password/current', async (req, res) => {
    const { password } = req.body;
    if (!req.session.loggedin) return res.redirect('/logout');

    const query = 'SELECT * FROM `users` WHERE user_id = ? LIMIT 1';
    connection.query(query, [ req.session.user_id ], async (err, result) => {
        if (err) {
            console.log(err);
            return res.render('pages/currentPassword', { errorMessage: 'Unknown Error!' });
        }

        if (!result.length > 0) return res.render('pages/login', { errorMessage: 'Incorrect UserID or Password!' });
        const isMatch = await bcrypt.compare(password.toString(), result[0].password);
        if (!isMatch) return res.render('pages/currentPassword', { errorMessage: 'Incorrect Password!' });

        req.session.changePassword = true;

        expiredReset.push({ 
            'user_id': req.session.user_id,
            'expired': Date.now() + 1500000
        });

        res.redirect('/password/change');
    });
});

app.get('/password/change', async (req, res) => {
    if (!req.session.loggedin) return res.redirect('/logout');
    if (!(expiredReset.find(u => u.user_id === req.session.user_id))?.expired) return res.redirect('/password/current');

    if (Date.now() > (expiredReset.find(u => u.user_id === req.session.user_id)).expired) {
        const index = expiredReset.findIndex(user => user.user_id === req.session.user_id);
        if (index !== -1) expiredReset.splice(index, 1);
    }

    res.render('pages/changePassword', { errorMessage: null });
});

app.post('/password/change', async (req, res) => {
    const { password, confirm_password } = req.body;
    if (!req.session.loggedin) return res.redirect('/logout');
    if (!(expiredReset.find(u => u.user_id === req.session.user_id))?.expired) return res.redirect('/password/current');

    if (Date.now() > (expiredReset.find(u => u.user_id === req.session.user_id)).expired) {
        const index = expiredReset.findIndex(user => user.user_id === req.session.user_id);
        if (index !== -1) expiredReset.splice(index, 1);
    }

    if (password !== confirm_password) return res.render('pages/changePassword', { errorMessage: 'New Password and Confirm Password do not match!' });

    const hashpw = await bcrypt.hash(password, 12);

    const query = 'UPDATE users SET password = ? WHERE user_id = ?';
    connection.query(query, [ hashpw, req.session.user_id ], (err, result) => {
        res.redirect(`/@${req.session.user_id}`);
    });
});

app.get('/home', async (req, res) => {
    const { type } = req.query;
    if (!req.session.loggedin) return res.redirect('/logout');

    if (!type || type == 'foryou') {
        const query = 'SELECT tweet.*, users.image AS profile, (SELECT COUNT(*) FROM comment WHERE comment.tweet_id = tweet.tweet_id) AS comment_count, (SELECT COUNT(*) FROM likes WHERE likes.tweet_id = tweet.tweet_id) AS like_count, EXISTS(SELECT 1 FROM likes WHERE likes.tweet_id = tweet.tweet_id AND likes.user_id = ?) AS user_liked FROM tweet JOIN users ON tweet.user_id = users.user_id ORDER BY tweet.created_at DESC LIMIT 50';
        connection.query(query, [ req.session.user_id ], (err, result) => {
            if (err) {
                console.log(err);
                return res.redirect('/logout');
            }

            res.render('pages/home', { user_id: req.session.user_id, result: result, type: 'foryou' }, );
        });
    } else {
        const query = 'SELECT t.tweet_id, t.user_id, t.message, t.content, t.created_at, t.update_at, u.username, u.image AS profile, (SELECT COUNT(*) FROM comment WHERE comment.tweet_id = t.tweet_id) AS comment_count, (SELECT COUNT(*) FROM likes WHERE likes.tweet_id = t.tweet_id) AS like_count, EXISTS(SELECT 1 FROM likes WHERE likes.tweet_id = t.tweet_id AND likes.user_id = ?) AS user_liked FROM tweet AS t JOIN follows AS f ON t.user_id = f.following_id JOIN users AS u ON t.user_id = u.user_id WHERE f.user_id = ? ORDER BY t.created_at DESC LIMIT 50';
        connection.query(query, [ req.session.user_id, req.session.user_id ], (err, result) => {
            if (err) {
                console.log(err);
                return res.redirect('/logout');
            }
    
            res.render('pages/home', { user_id: req.session.user_id, result: result, type: 'following' });
        });
    }

});

app.get('/register', async (req, res) => {
    if (req.session.loggedin) {
        res.redirect('/home');
    } else {
        res.render('pages/register', { errorMessage: null });
    }
})

app.post('/register', async (req, res) => {
    const { user_id, username, email, password } = req.body;

    if (!/^[a-zA-Z0-9._]{2,30}$/.test(user_id)) return res.render('pages/register', { errorMessage: 'Usernames: 2-30 chars, only letters, numbers, ".", and "_". No spaces!' });
    const query = 'SELECT * FROM `users` WHERE user_id = ?';
    connection.query(query, [user_id.toString()], async (err, result) => {
        if (err) {
            console.log(err);
            return res.render('pages/register', { errorMessage: 'Unknown Error!' });
        }

        if (result.length !== 0) return res.render('pages/register', { errorMessage: 'UserID already exists!' });

        const hashpw = await bcrypt.hash(password, 12);

        const query = 'INSERT INTO users (user_id, username, image, description, email, password, created_at, update_at) VALUES (?, ?, "profile.png", "", ?, ?, NOW(), NOW())';
        connection.query(query, [user_id.toString(), username.toString(), email.toString(), hashpw], (err, result) => {
            if (err) {
                console.log(err);
                return res.render('pages/register', { errorMessage: 'Unknown Error!' });
            }

            res.redirect('/login');
        });
    });
});

app.get('/login', async (req, res) => {
    if (req.session.loggedin) {
        res.redirect('/home');
    } else {
        res.render('pages/login', { errorMessage: null });
    }
});

app.post('/login', async (req, res) => {
    const { user_id, password } = req.body;
    const query = 'SELECT * FROM `users` WHERE user_id = ? LIMIT 1';
    connection.query(query, [ user_id.toString() ], async (err, result) => {
        if (err) {
            console.log(err);
            return res.render('pages/login', { errorMessage: 'Unknown Error!' });
        }

        // not found
        if (!result.length > 0) return res.render('pages/login', { errorMessage: 'Incorrect UserID or Password!' });
        const isMatch = await bcrypt.compare(password.toString(), result[0].password);
        if (!isMatch) return res.render('pages/login', { errorMessage: 'Incorrect UserID or Password!' });

        // result success
        req.session.user_id = result[0].user_id;
        req.session.loggedin = true;

        res.redirect('/home');
    });
});

app.get('/search', async (req, res) => {
    const { search } = req.query;
    if (req.session.loggedin) {
        if (search) {
            const query = `SELECT user_id, username, image FROM users WHERE user_id LIKE "%${search.toString()}%" OR username LIKE "%${search.toString()}%" LIMIT 50`;
            connection.query(query, (err, result) => {
                if (err) {
                    console.log(err);
                    res.redirect('/search');
                }
    
                return res.render('pages/search', { result: result, search: search, user_id: req.session.user_id });
            });
        } else {
            const query = `SELECT user_id, username, image FROM users ORDER BY RAND() LIMIT 50`;
            connection.query(query, (err, result) => {
                if (err) {
                    console.log(err);
                    res.redirect('/search');
                }
    
                return res.render('pages/search', { result: result, search: null, user_id: req.session.user_id });
            });
        }

    } else {
        res.redirect('/login');
    }
});

app.get('/logout', async (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/post', async (req, res) => {
    if (req.session.loggedin) {
        res.render('pages/post', { user_id: req.session.user_id });
    } else {
        res.redirect('/login');
    }
});

app.post('/post', postUpload.single('image'), async (req, res) => {
    const { description } = req.body;
    if (req.file) {
        let query = `INSERT INTO tweet VALUES (NULL, ?, ?, ?, NOW(), NOW())`;
        connection.query(query, [ req.session.user_id, description.toString(), req.file.filename.toString() ], (err, result) => {
            if (err) {
                console.log(err);
                res.redirect(`/post`);
            }
            
            res.redirect(`/home`);
        });
    } else {
        const query = `INSERT INTO tweet VALUES (NULL, ?, ?, '', NOW(), NOW())`;
        connection.query(query, [ req.session.user_id, description.toString() ], (err, result) => {
            if (err) {
                console.log(err);
                res.redirect(`/post`);
            }
            
            res.redirect(`/home`);
        });
    }
});

app.post('/follow', async (req, res) => {
    const { userid } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT * FROM follows WHERE user_id = ? AND following_id = ?';
    connection.query(check, [ req.session.user_id, userid ], (err, result) => {
        if (result.length > 0) return;
        let follow = `INSERT INTO follows VALUES (NULL, ?, ?, NOW())`;
        connection.query(follow, [ req.session.user_id, userid ], (err, result) => { 
            res.redirect('/' + userid);
        });
    });
});

app.post('/unfollow', async (req, res) => {
    const { userid } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT * FROM follows WHERE user_id = ? AND following_id = ?';
    connection.query(check, [ req.session.user_id, userid ], (err, result) => {
        if (result.length <= 0) return;
        let follow = `DELETE FROM follows WHERE user_id = ? AND following_id = ?`;
        connection.query(follow, [ req.session.user_id, userid ], (err, result) => { 
            res.redirect('/' + userid);
        });
    });
});

app.post('/like', async (req, res) => {
    const { tweetid } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT * FROM likes WHERE tweet_id = ? AND user_id = ?';
    connection.query(check, [ tweetid, req.session.user_id ], (err, result) => {
        if (result.length > 0) return;
        let likes = `INSERT INTO likes VALUES (NULL, ?, ?, NOW())`;
        connection.query(likes, [ tweetid, req.session.user_id ]);
    });
});

app.post('/unlike', async (req, res) => {
    const { tweetid } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT * FROM likes WHERE tweet_id = ? AND user_id = ?';
    connection.query(check, [ tweetid, req.session.user_id ], (err, result) => {
        if (result.length <= 0) return;
        let unlikes = `DELETE FROM likes WHERE tweet_id = ? AND user_id = ?`;
        connection.query(unlikes, [ tweetid, req.session.user_id ]);
    });
});

app.post('/remove', async (req, res) => {
    const { tweetid } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT * FROM tweet WHERE tweet_id = ? AND user_id = ?';
    connection.query(check, [ tweetid, req.session.user_id ], (err, result) => {
        if (result.length <= 0) return;
        let removePost = `DELETE FROM tweet WHERE tweet_id = ? AND user_id = ?`;
        connection.query(removePost, [ tweetid, req.session.user_id ]);
    });
});

app.post('/remove/comment', async (req, res) => {
    const { commentid } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT * FROM comment WHERE comment_id = ? AND user_id = ?';
    connection.query(check, [ commentid, req.session.user_id ], (err, result) => {
        if (result.length <= 0) return;
        let removeComment = `DELETE FROM comment WHERE comment_id = ? AND user_id = ?`;
        connection.query(removeComment, [ commentid, req.session.user_id ]);
    });
});

app.get('/tweet/:tweetid', async (req, res) => {
    const { tweetid } = req.params;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT tweet.*, users.image AS profile, (SELECT COUNT(*) FROM comment WHERE comment.tweet_id = tweet.tweet_id) AS comment_count, (SELECT COUNT(*) FROM likes WHERE likes.tweet_id = tweet.tweet_id) AS like_count, EXISTS(SELECT 1 FROM likes WHERE likes.tweet_id = tweet.tweet_id AND likes.user_id = ?) AS user_liked FROM tweet JOIN users ON tweet.user_id = users.user_id WHERE tweet_id = ?;';
    connection.query(check, [ req.session.user_id, tweetid ], (err, result) => {
        let commentSql = 'SELECT comment.*, users.image AS profile FROM comment JOIN users ON comment.user_id = users.user_id WHERE comment.tweet_id = ?';
        connection.query(commentSql, [ tweetid ], (err, comment) => {
            res.render('pages/tweet', { user_id: req.session.user_id, result: result, comment: comment });
        });
    });
});

app.post('/tweet/:tweetid', async (req, res) => {
    const { tweetid } = req.params;
    const { comment } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');

    let check = 'SELECT *, EXISTS(SELECT 1 FROM tweet WHERE tweet_id = ?) AS isExists FROM users WHERE user_id = ?';
    connection.query(check, [ tweetid, req.session.user_id ], (err, result) => {
        if (!result[0].isExists) return res.redirect('/home');
        let commentSql = 'INSERT INTO comment VALUES (NULL, ?, ?, ?, NOW())';
        connection.query(commentSql, [ tweetid, req.session.user_id, comment ], (err, result) => {
            res.redirect(`/tweet/${tweetid}`);
        });
    });
});

app.get('/likes/:tweetid', async (req, res) => {
    const { tweetid } = req.params;
    const { search } = req.query;
    if (!req.session.loggedin) return res.redirect('/login');

    if (search) {
        let query = `SELECT likes.*, tweet.user_id AS tweet_userid, users.image, users.username FROM likes JOIN tweet ON likes.tweet_id = tweet.tweet_id JOIN users ON likes.user_id = users.user_id WHERE (users.user_id LIKE "%${search.toString()}%" OR users.username LIKE "%${search.toString()}%") AND likes.tweet_id = ?`;
        connection.query(query, [ tweetid ], (err, result) => {
            res.render('pages/likes', { result: result, user_id: req.session.user_id, search: null, tweet_id: tweetid });
        });
    } else {
        let query = 'SELECT likes.*, tweet.user_id AS tweet_userid, users.image, users.username FROM likes JOIN tweet ON likes.tweet_id = tweet.tweet_id JOIN users ON likes.user_id = users.user_id WHERE likes.tweet_id = ?';
        connection.query(query, [ tweetid ], (err, result) => {
            res.render('pages/likes', { result: result, user_id: req.session.user_id, search: null, tweet_id: tweetid });
        });
    }
})

app.get('/:user', async (req, res) => {
    const { user } = req.params;
    const { type } = req.query;
    if (!user.includes('@')) return;
    let replaceUsername = user.replace('@', '').toString();

    if (req.session.loggedin) {
        if (req.session.user_id == replaceUsername) {
            const query = `SELECT * FROM users WHERE user_id = ? LIMIT 1`;
            connection.query(query, [req.session.user_id], (err, result) => {
                if (err) {
                    console.log(err);
                    res.redirect('/home');
                }

                if (type == 'comment') {
                    const commentData = 'SELECT *, users.image AS profile FROM comment JOIN users ON comment.user_id = users.user_id WHERE users.user_id = ? ORDER BY comment.created_at DESC';
                    connection.query(commentData, [req.session.user_id], async (err, comment) => {
                        if (err) {
                            console.log(err);
                            res.redirect('/home');
                        }

                        const followingQuery = `SELECT * FROM follows WHERE user_id = ?`;
                        connection.query(followingQuery, [replaceUsername], async (err, following) => {
                            const followersQuery = `SELECT * FROM follows WHERE following_id = ?`;
                            connection.query(followersQuery, [replaceUsername], async (err, followers) => {
                                return res.render('pages/profile', { result: result, myaccount: true, user_id: req.session.user_id, comment: comment, followers: followers.length, following: following.length, type: 'comment' });
                            });
                        });
                    });
                } else {
                    const tweetData = 'SELECT *, (SELECT COUNT(*) FROM comment WHERE comment.tweet_id = tweet.tweet_id) AS comment_count, (SELECT COUNT(*) FROM likes WHERE likes.tweet_id = tweet.tweet_id) AS like_count, EXISTS(SELECT 1 FROM likes WHERE likes.tweet_id = tweet.tweet_id AND likes.user_id = ?) AS user_liked FROM tweet JOIN users ON tweet.user_id = users.user_id WHERE users.user_id = ? ORDER BY tweet.created_at DESC';
                    connection.query(tweetData, [req.session.user_id, req.session.user_id], async (err, tweet) => {
                        if (err) {
                            console.log(err);
                            res.redirect('/home');
                        }

                        const followingQuery = `SELECT * FROM follows WHERE user_id = ?`;
                        connection.query(followingQuery, [replaceUsername], async (err, following) => {
                            const followersQuery = `SELECT * FROM follows WHERE following_id = ?`;
                            connection.query(followersQuery, [replaceUsername], async (err, followers) => {
                                return res.render('pages/profile', { result: result, myaccount: true, user_id: req.session.user_id, tweet: tweet, followers: followers.length, following: following.length, type: 'tweet' });
                            });
                        });
                    });
                }
            });
        } else {
            let followCondition;
            const followed = 'SELECT * FROM follows WHERE user_id = ? AND following_id = ?';
            connection.query(followed, [ req.session.user_id, replaceUsername ], (err, result) => {
                if (result.length > 0) return followCondition = true;
                return followCondition = false;
            });

            const query = `SELECT * FROM users WHERE user_id = ? LIMIT 1`;
            connection.query(query, [replaceUsername], (err, result) => {
                if (err) {
                    console.log(err);
                    res.redirect('/home');
                }

                if (type == 'comment') {
                    const commentData = 'SELECT *, users.image AS profile FROM comment JOIN users ON comment.user_id = users.user_id WHERE users.user_id = ? ORDER BY comment.created_at DESC';
                    connection.query(commentData, [replaceUsername], async (err, comment) => {
                        if (err) {
                            console.log(err);
                            res.redirect('/home');
                        }

                        const followingQuery = `SELECT * FROM follows WHERE user_id = ?`;
                        connection.query(followingQuery, [replaceUsername], async (err, following) => {
                            const followersQuery = `SELECT * FROM follows WHERE following_id = ?`;
                            connection.query(followersQuery, [replaceUsername], async (err, followers) => {
                                return res.render('pages/profile', { result: result, myaccount: false, user_id: req.session.user_id, followed: followCondition, comment: comment, followers: followers.length, following: following.length, type: 'comment' });
                            });
                        });
                    });
                } else {
                    const tweetData = 'SELECT *, (SELECT COUNT(*) FROM comment WHERE comment.tweet_id = tweet.tweet_id) AS comment_count, (SELECT COUNT(*) FROM likes WHERE likes.tweet_id = tweet.tweet_id) AS like_count, EXISTS(SELECT 1 FROM likes WHERE likes.tweet_id = tweet.tweet_id AND likes.user_id = ?) AS user_liked FROM tweet JOIN users ON tweet.user_id = users.user_id WHERE users.user_id = ? ORDER BY tweet.created_at DESC';
                    connection.query(tweetData, [ req.session.user_id, replaceUsername], async (err, tweet) => {
                        if (err) {
                            console.log(err);
                            res.redirect('/home');
                        }

                        const followingQuery = `SELECT * FROM follows WHERE user_id = ?`;
                        connection.query(followingQuery, [replaceUsername], async (err, following) => {
                            const followersQuery = `SELECT * FROM follows WHERE following_id = ?`;
                            connection.query(followersQuery, [replaceUsername], async (err, followers) => {
                                return res.render('pages/profile', { result: result, myaccount: false, user_id: req.session.user_id, tweet: tweet, followed: followCondition, followers: followers.length, following: following.length, type: 'tweet' });
                            });
                        });

                    });
                }
            });
        }
    } else {
        res.redirect('/login');
    }
});

app.get('/:user/edit', async (req, res) => {
    const { user } = req.params;
    if (!req.session.loggedin) return res.redirect('/login');
    let replaceUsername = user.replace('@', '').toString();
    
    if (req.session.user_id == replaceUsername) {
        const query = `SELECT * FROM users WHERE user_id = ? LIMIT 1`;
        connection.query(query, [replaceUsername], (err, result) => {
            if (err) {
                console.log(err);
                res.redirect(`/@${req.session.user_id}`);
            }
            
            if (req.query.errorMessage == 'userid') return res.render('pages/edit', { result: result, user_id: req.session.user_id, errorMessage: 'Usernames: 2-30 chars, only letters, numbers, ".", and "_". No spaces!' });
            return res.render('pages/edit', { result: result, user_id: req.session.user_id, errorMessage: null });
        });
    } else {
        res.redirect(`/@${req.session.user_id}/edit`)
    } 
});

app.post('/:user/edit', profileUpload.single('image'), async (req, res) => {
    const { user } = req.params;
    const { user_id, username, description, email } = req.body;
    if (!req.session.loggedin) return res.redirect('/login');
    let replaceUsername = user.replace('@', '');

    if (!/^[a-zA-Z0-9._]{2,30}$/.test(user_id)) return res.redirect(`/${user}/edit?errorMessage=userid`);

    if (req.session.user_id == replaceUsername) {
        if (req.file) {
            let query = `UPDATE users SET user_id= ?, username= ?, image= ?, description= ?, email= ?, update_at=NOW() WHERE user_id='${req.session.user_id}'`;
            connection.query(query, [user_id.toString(), username.toString(), req.file.filename.toString(), description.toString(), email.toString()], (err, result) => {
                if (err) {
                    console.log(err);
                    res.redirect(`/@${req.session.user_id}`);
                }
                
                req.session.user_id = user_id.toString();
                res.redirect(`/@${user_id.toString()}`);
            });
        } else {
            const query = `UPDATE users SET user_id= ?, username= ?, description= ?, email= ?, update_at=NOW() WHERE user_id='${req.session.user_id}'`;
            connection.query(query, [user_id, username, description, email], (err, result) => {
                if (err) {
                    console.log(err);
                    res.redirect(`/@${req.session.user_id}`);
                }
                
                req.session.user_id = user_id.toString();
                res.redirect(`/@${user_id.toString()}`);
            });
        }
    } else {
        res.redirect(`/@${req.session.user_id}/edit`)
    } 
});

app.get('/:user/followers', async (req, res) => {
    const { user } = req.params;
    const { search } = req.query;
    if (!req.session.loggedin) return res.redirect('/login');
    let replaceUsername = user.replace('@', '');

    if (search) {
        if (req.session.user_id == replaceUsername) {
            let check = `SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.user_id = users.user_id WHERE (users.user_id LIKE "%${search}%" OR users.username LIKE "%${search}%") AND follows.following_id = ?`;
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/followers', { result: result, myaccount: true, user_id: req.session.user_id, search: search, user: user });
            });
        } else {
            let check = `SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.user_id = users.user_id WHERE (users.user_id LIKE "%${search}%" OR users.username LIKE "%${search}%") AND follows.following_id = ?`;
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/followers', { result: result, myaccount: false, user_id: req.session.user_id, search: search, user: user });

            });
        }
    } else {
        if (req.session.user_id == replaceUsername) {
            let check = 'SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.user_id = users.user_id WHERE following_id = ? ORDER BY created_at DESC';
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/followers', { result: result, myaccount: true, user_id: req.session.user_id, search: null, user: user });
            });
        } else {
            let check = 'SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.user_id = users.user_id WHERE following_id = ? ORDER BY created_at DESC';
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/followers', { result: result, myaccount: false, user_id: req.session.user_id, search: null, user: user });
            });
        }
    }
});

app.get('/:user/following', async (req, res) => {
    const { user } = req.params;
    const { search } = req.query;
    if (!req.session.loggedin) return res.redirect('/login');
    let replaceUsername = user.replace('@', '');

    if (search) {
        if (req.session.user_id == replaceUsername) {
            let check = `SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.following_id = users.user_id WHERE (users.user_id LIKE "%${search}%" OR users.username LIKE "%${search}%") AND follows.user_id = ?`;
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/following', { result: result, myaccount: true, user_id: req.session.user_id, search: search, user: user });
            });
        } else {
            let check = `SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.following_id = users.user_id WHERE (users.user_id LIKE "%${search}%" OR users.username LIKE "%${search}%") AND follows.user_id = ?`;
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/following', { result: result, myaccount: false, user_id: req.session.user_id, search: search, user: user });
            });
        }
    } else {
        if (req.session.user_id == replaceUsername) {
            let check = 'SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.following_id = users.user_id WHERE follows.user_id = ? ORDER BY created_at DESC';
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/following', { result: result, myaccount: true, user_id: req.session.user_id, search: null, user: user });
            });
        } else {
            let check = 'SELECT follows.*, users.username, users.image, users.user_id FROM follows JOIN users ON follows.following_id = users.user_id WHERE follows.user_id = ? ORDER BY created_at DESC';
            connection.query(check, [ replaceUsername ], (err, result) => {
                res.render('pages/following', { result: result, myaccount: false, user_id: req.session.user_id, search: null, user: user });
            });
        }
    }
});

server.listen(3000, () => {
    console.log('[WEB] Website Already');
});