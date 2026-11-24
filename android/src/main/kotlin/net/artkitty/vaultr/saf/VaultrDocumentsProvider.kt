package net.artkitty.vaultr.saf

import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import java.io.File
import java.io.FileNotFoundException

/**
 * VaultrDocumentsProvider
 * Exposes Vaultr's flat-file repository and dynamic virtual shelves directly
 * into Android's system document picker drawer (Storage Access Framework).
 *
 * Apps like Kittlibr, Moon+ Reader, VLC, and text editors can navigate
 * dynamic folders ("Inbox Review", "New (24h)", "Books & Docs") as first-class directories.
 */
class VaultrDocumentsProvider : DocumentsProvider() {

    companion object {
        const val AUTHORITY = "net.artkitty.vaultr.documents"

        // Roots
        private const val ROOT_ID_VAULTR = "vaultr_storage"
        private const val ROOT_ID_DYNAMIC = "vaultr_dynamic_shelves"

        // Document ID Prefixes
        private const val DOC_PREFIX_ROOT = "root:"
        private const val DOC_PREFIX_DYNAMIC = "dynamic:"
        private const val DOC_PREFIX_FILE = "file:"

        private val DEFAULT_ROOT_PROJECTION = arrayOf(
            Root.COLUMN_ROOT_ID,
            Root.COLUMN_ICON,
            Root.COLUMN_TITLE,
            Root.COLUMN_SUMMARY,
            Root.COLUMN_FLAGS,
            Root.COLUMN_DOCUMENT_ID
        )

        private val DEFAULT_DOCUMENT_PROJECTION = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE,
            Document.COLUMN_LAST_MODIFIED,
            Document.COLUMN_FLAGS
        )
    }

    override fun onCreate(): Boolean = true

    /**
     * 1. Declare Roots (Appears in Android SAF side drawer)
     */
    override fun queryRoots(projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DEFAULT_ROOT_PROJECTION)

        // Root 1: Full Vaultr Repository
        cursor.newRow().apply {
            add(Root.COLUMN_ROOT_ID, ROOT_ID_VAULTR)
            add(Root.COLUMN_DOCUMENT_ID, "${DOC_PREFIX_ROOT}vault")
            add(Root.COLUMN_TITLE, "Vaultr ⚡")
            add(Root.COLUMN_SUMMARY, "Local & Remote Sidecar Vault")
            add(Root.COLUMN_ICON, android.R.drawable.ic_menu_agenda)
            add(
                Root.COLUMN_FLAGS,
                Root.FLAG_SUPPORTS_CREATE or Root.FLAG_SUPPORTS_IS_CHILD
            )
        }

        // Root 2: Dynamic Virtual Shelves (Direct access to virtual folders)
        cursor.newRow().apply {
            add(Root.COLUMN_ROOT_ID, ROOT_ID_DYNAMIC)
            add(Root.COLUMN_DOCUMENT_ID, "${DOC_PREFIX_ROOT}dynamic")
            add(Root.COLUMN_TITLE, "Vaultr Dynamic Shelves ✨")
            add(Root.COLUMN_SUMMARY, "Dynamic Folders & 24h Arrivals")
            add(Root.COLUMN_ICON, android.R.drawable.ic_menu_view)
            add(Root.COLUMN_FLAGS, Root.FLAG_EMPTY)
        }

        return cursor
    }

    /**
     * 2. Query metadata for a single item (root, folder, or file)
     */
    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: DEFAULT_DOCUMENT_PROJECTION)
        includeDocument(cursor, documentId)
        return cursor
    }

    /**
     * 3. Query children of a folder or dynamic shelf
     */
    override fun queryChildDocuments(
        parentDocumentId: String,
        projection: Array<out String>?,
        sortOrder: String?
    ): Cursor {
        val cursor = MatrixCursor(projection ?: DEFAULT_DOCUMENT_PROJECTION)

        when {
            // Browsing the Dynamic Shelves root: return dynamic folder items
            parentDocumentId == "${DOC_PREFIX_ROOT}dynamic" -> {
                val dynamicFolders = getAvailableDynamicShelves()
                for (shelf in dynamicFolders) {
                    cursor.newRow().apply {
                        add(Document.COLUMN_DOCUMENT_ID, "${DOC_PREFIX_DYNAMIC}$shelf")
                        add(Document.COLUMN_DISPLAY_NAME, "📁 $shelf")
                        add(Document.COLUMN_MIME_TYPE, Document.MIME_TYPE_DIR)
                        add(Document.COLUMN_FLAGS, 0)
                    }
                }
            }

            // Browsing inside a specific dynamic folder
            parentDocumentId.startsWith(DOC_PREFIX_DYNAMIC) -> {
                val shelfName = parentDocumentId.removePrefix(DOC_PREFIX_DYNAMIC)
                val matchingFiles = getFilesForDynamicShelf(shelfName)
                for (file in matchingFiles) {
                    includeFile(cursor, file)
                }
            }

            // Browsing physical directory
            else -> {
                val parentFile = getFileForDocId(parentDocumentId)
                parentFile.listFiles()?.forEach { file ->
                    includeFile(cursor, file)
                }
            }
        }

        return cursor
    }

    /**
     * 4. Open document data stream
     */
    override fun openDocument(
        documentId: String,
        mode: String,
        signal: CancellationSignal?
    ): ParcelFileDescriptor {
        val file = getFileForDocId(documentId)
        val accessMode = ParcelFileDescriptor.parseMode(mode)
        return ParcelFileDescriptor.open(file, accessMode)
    }

    // --- Helpers ---

    private fun getVaultRootDir(): File {
        val ctx = context ?: throw IllegalStateException("Context unavailable")
        return File(ctx.filesDir, "meow-vault").apply { if (!exists()) mkdirs() }
    }

    private fun getFileForDocId(documentId: String): File {
        val root = getVaultRootDir()
        if (documentId == "${DOC_PREFIX_ROOT}vault") return root

        val cleanPath = documentId.removePrefix(DOC_PREFIX_FILE)
            .removePrefix(DOC_PREFIX_DYNAMIC)
            .removePrefix(DOC_PREFIX_ROOT)

        val file = File(root, cleanPath)
        if (!file.exists()) {
            throw FileNotFoundException("File not found for docId: $documentId")
        }
        return file
    }

    private fun includeDocument(cursor: MatrixCursor, documentId: String) {
        val row = cursor.newRow()
        row.add(Document.COLUMN_DOCUMENT_ID, documentId)

        if (documentId.startsWith(DOC_PREFIX_ROOT) || documentId.startsWith(DOC_PREFIX_DYNAMIC)) {
            val title = when (documentId) {
                "${DOC_PREFIX_ROOT}vault" -> "Vaultr"
                "${DOC_PREFIX_ROOT}dynamic" -> "Dynamic Shelves"
                else -> documentId.substringAfter(":")
            }
            row.add(Document.COLUMN_DISPLAY_NAME, title)
            row.add(Document.COLUMN_MIME_TYPE, Document.MIME_TYPE_DIR)
            row.add(Document.COLUMN_FLAGS, 0)
        } else {
            val file = getFileForDocId(documentId)
            includeFile(cursor, file)
        }
    }

    private fun includeFile(cursor: MatrixCursor, file: File) {
        cursor.newRow().apply {
            add(Document.COLUMN_DOCUMENT_ID, "${DOC_PREFIX_FILE}${file.name}")
            add(Document.COLUMN_DISPLAY_NAME, file.name)
            add(Document.COLUMN_SIZE, file.length())
            add(Document.COLUMN_LAST_MODIFIED, file.lastModified())
            add(
                Document.COLUMN_MIME_TYPE,
                if (file.isDirectory) Document.MIME_TYPE_DIR else getMimeType(file)
            )
            add(
                Document.COLUMN_FLAGS,
                Document.FLAG_SUPPORTS_WRITE or Document.FLAG_SUPPORTS_DELETE
            )
        }
    }

    private fun getAvailableDynamicShelves(): List<String> {
        return listOf(
            "New (24h)",
            "Downloads (24h)",
            "Inbox Review",
            "Reading Queue",
            "Books & Docs",
            "Audio & Media"
        )
    }

    private fun getFilesForDynamicShelf(shelfName: String): List<File> {
        val root = getVaultRootDir()
        val allFiles = root.walkTopDown().filter { it.isFile && !it.name.startsWith(".") }.toList()
        val now = System.currentTimeMillis()
        val dayMs = 24 * 60 * 60 * 1000

        return when (shelfName) {
            "New (24h)", "Downloads (24h)" -> {
                allFiles.filter { (now - it.lastModified()) < dayMs }
            }
            "Books & Docs" -> {
                allFiles.filter { it.extension.lowercase() in listOf("epub", "pdf", "md", "txt", "mobi") }
            }
            "Audio & Media" -> {
                allFiles.filter { it.extension.lowercase() in listOf("mp3", "mp4", "flac", "m4a", "wav") }
            }
            else -> {
                allFiles.take(15)
            }
        }
    }

    private fun getMimeType(file: File): String {
        return when (file.extension.lowercase()) {
            "epub" -> "application/epub+zip"
            "md", "txt" -> "text/plain"
            "pdf" -> "application/pdf"
            "anymd" -> "text/yaml"
            "mp3" -> "audio/mpeg"
            "mp4" -> "video/mp4"
            else -> "application/octet-stream"
        }
    }
}
