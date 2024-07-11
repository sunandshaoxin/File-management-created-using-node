const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const flash = require('express-flash');
const session = require('express-session');

const app = express();
const port = 89;

const UPLOAD_FOLDER = 'uploads';
const ZIP_FOLDER = 'zip';

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true
}));
app.use(flash());

if (!fs.existsSync(UPLOAD_FOLDER)) {
    fs.mkdirSync(UPLOAD_FOLDER);
}
if (!fs.existsSync(ZIP_FOLDER)) {
    fs.mkdirSync(ZIP_FOLDER);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'html'));

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

function renderTemplate(res, template, data) {
    res.render(template, data);
}

app.get('/', (req, res) => {
    let pathParam = decodeURIComponent(req.query.path || '');
    let currentPath = path.join(UPLOAD_FOLDER, pathParam);

    if (!fs.existsSync(currentPath)) {
        req.flash('error', '路径不存在');
        renderTemplate(res, 'index', { error: '路径不存在' });
        return;
    }

    let parentPath = path.dirname(pathParam) || '';

    let items = [];
    let files = fs.readdirSync(currentPath);
    files.forEach(item => {
        let fullItemPath = path.join(currentPath, item);
        let itemType = fs.statSync(fullItemPath).isFile() ? '文件' : '文件夹';
        items.push({ item, item_type: itemType, item_path: path.join(pathParam, item) });
    });

    renderTemplate(res, 'index', { items, current_path: pathParam, parent_path: parentPath });
});

app.get('/download/:filename', (req, res) => {
    let pathParam = decodeURIComponent(req.query.path || '');
    let filePath = path.join(UPLOAD_FOLDER, pathParam, req.params.filename);
    res.download(filePath);
});

app.post('/delete/:filename', (req, res) => {
    let pathParam = decodeURIComponent(req.body.path || '');
    let fullPath = path.join(UPLOAD_FOLDER, pathParam, req.params.filename);

    if (fs.existsSync(fullPath)) {
        if (fs.statSync(fullPath).isFile()) {
            fs.unlinkSync(fullPath);
        } else {
            fs.rmdirSync(fullPath, { recursive: true });
        }
        req.flash('success', `删除 ${req.params.filename} 成功`);
    } else {
        req.flash('error', `${req.params.filename} 不存在`);
    }
    res.redirect(`/?path=${encodeURIComponent(pathParam)}`);
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = path.join(__dirname, UPLOAD_FOLDER, decodeURIComponent(req.body.path || ''));
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        let fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, fileName);
    }
});

const upload = multer({ storage: storage });

app.post('/upload', upload.single('file'), (req, res) => {
    let pathParam = decodeURIComponent(req.body.path || '');
    req.flash('success', '文件上传成功');
    res.redirect(`/?path=${encodeURIComponent(pathParam)}`);
});

app.post('/upload_folder', upload.array('files'), (req, res) => {
    let pathParam = decodeURIComponent(req.body.path || '');
    let files = req.files;

    files.forEach(file => {
        let filePath = Buffer.from(file.originalname, 'latin1').toString('utf8');
        let fileDir = path.join(UPLOAD_FOLDER, pathParam, path.dirname(filePath));
        
        if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
        }

        let destPath = path.join(UPLOAD_FOLDER, pathParam, filePath);
        fs.renameSync(file.path, destPath);
    });

    req.flash('success', '文件夹上传成功');
    res.redirect(`/?path=${encodeURIComponent(pathParam)}`);
});

app.post('/create_folder', (req, res) => {
    let pathParam = decodeURIComponent(req.body.path || '');
    let folderName = req.body.folder_name;
    let newFolderPath = path.join(UPLOAD_FOLDER, pathParam, folderName);

    if (!fs.existsSync(newFolderPath)) {
        fs.mkdirSync(newFolderPath);
        req.flash('success', `文件夹 ${folderName} 创建成功`);
    } else {
        req.flash('error', `文件夹 ${folderName} 已存在`);
    }
    res.redirect(`/?path=${encodeURIComponent(pathParam)}`);
});

app.post('/create_file', (req, res) => {
    let pathParam = decodeURIComponent(req.body.path || '');
    let fileName = req.body.file_name;
    let newFilePath = path.join(UPLOAD_FOLDER, pathParam, fileName);

    if (!fs.existsSync(newFilePath)) {
        fs.writeFileSync(newFilePath, '');
        req.flash('success', `文件 ${fileName} 创建成功`);
    } else {
        req.flash('error', `文件 ${fileName} 已存在`);
    }
    res.redirect(`/?path=${encodeURIComponent(pathParam)}`);
});

app.get('/open_folder/*', (req, res) => {
    let folderPath = req.params[0];
    res.redirect(`/?path=${encodeURIComponent(folderPath)}`);
});

app.get('/download_folder/:foldername', (req, res) => {
    let pathParam = decodeURIComponent(req.query.path || '');
    let folderPath = path.join(UPLOAD_FOLDER, pathParam, req.params.foldername);

    if (!fs.existsSync(folderPath)) {
        req.flash('error', '文件夹不存在');
        res.redirect(`/?path=${encodeURIComponent(pathParam)}`);
        return;
    }

    let zipFilename = req.params.foldername + '.zip';
    let zipPath = path.join(ZIP_FOLDER, zipFilename);

    let output = fs.createWriteStream(zipPath);
    let archive = archiver('zip', {
        zlib: { level: 9 }
    });

    output.on('close', function() {
        res.download(zipPath);
    });

    output.on('end', function() {
        console.log('Data has been drained');
    });

    archive.on('warning', function(err) {
        if (err.code === 'ENOENT') {
            console.log('压缩警告', err);
        } else {
            throw err;
        }
    });

    archive.on('error', function(err) {
        throw err;
    });

    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
});

app.post('/rename', (req, res) => {
    let pathParam = decodeURIComponent(req.body.path || '');
    let oldName = req.body.old_name;
    let newName = req.body.new_name;
    let oldPath = path.join(UPLOAD_FOLDER, pathParam, oldName);
    let newPath = path.join(UPLOAD_FOLDER, pathParam, newName);

    if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        req.flash('success', `${oldName} 重命名为 ${newName} 成功`);
    } else {
        req.flash('error', `${oldName} 不存在`);
    }
    res.redirect(`/?path=${encodeURIComponent(pathParam)}`);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
