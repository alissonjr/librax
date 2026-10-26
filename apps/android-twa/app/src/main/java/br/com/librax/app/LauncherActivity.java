package br.com.librax.app;

import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

/**
 * Abre o site do Librax numa Trusted Web Activity (androidbrowserhelper faz o resto: splash,
 * verificação do Digital Asset Links e a Custom Tab quando o Chrome não tem TWA).
 *
 * Só duas coisas a mais que o LauncherActivity da biblioteca:
 * - retrato fixo na abertura (no Android 8.0 uma activity translúcida com orientação fixa fecha
 *   sozinha, por isso só a partir do 8.1; o Chrome segue o retrato do manifesto do TWA);
 * - links https://<dominio>/... abertos pelo app também levam o ?origem=android, para o site
 *   saber que está dentro do app (apps/web-poc/src/lib/twa.ts).
 */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    @Override
    protected Uri getLaunchingUrl() {
        Uri uri = super.getLaunchingUrl();
        String param = getString(R.string.launchParam);
        if (uri == null || param.isEmpty() || !uri.isHierarchical()) return uri;
        String[] pair = param.split("=", 2);
        if (uri.getQueryParameter(pair[0]) != null) return uri;
        return uri.buildUpon().appendQueryParameter(pair[0], pair.length > 1 ? pair[1] : "").build();
    }
}
